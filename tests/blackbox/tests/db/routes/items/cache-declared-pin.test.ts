import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
	type StepFunctions,
} from '@common/cucumber';
import {
	CreateCollections,
	CreateFieldM2O,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import Redis from 'ioredis';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest';

const SLOT = 'declared_pin_slot';
const ZONE = 'declared_pin_zone';

// Creating a signal rewrites a slot behind the items service and declares what
// it touched (`extensions/cache-declared-pin`), so no purge but the declaration
// reaches the slot's reads.
const SIGNAL = 'declared_pin_signal';

const cacheStatusHeader = 'x-cache-status';

type SlotRow = {
	marker: string;
	owner: string;
	zone: string | null;
	note: string;
	amount: number;
};

const feature = loadFeature(
	'./tests/db/routes/items/cache-declared-pin.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = `directus-declared-pin-${vendor}`;

	let instance: ChildProcess;

	const redis = new Redis({
		host: env[vendor]['REDIS_HOST'],
		port: Number(env[vendor]['REDIS_PORT']),
	});

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	// A slot names its zone by the marker the zone was created under.
	const zoneIds = new Map<string, number>();

	beforeAll(async () => {
		// The scoped instance reads `scoped_cache_fields` off the schema it boots on,
		// so the collections precede the spawn.
		await CreateCollections(vendor, {
			collections: [
				{
					collection: SLOT,
					fields: [
						{ field: 'owner', type: 'string', meta: {} },
						{ field: 'note', type: 'string', meta: {} },
						{ field: 'amount', type: 'integer', meta: {} },
					],
				},
				{
					collection: ZONE,
					fields: [{ field: 'label', type: 'string', meta: {} }],
				},
				{
					collection: SIGNAL,
					fields: [
						{ field: 'rewritten_collection', type: 'string', meta: {} },
						{ field: 'rewritten_id', type: 'integer', meta: {} },
						{ field: 'rewritten_note', type: 'string', meta: {} },
						{ field: 'declared', type: 'json', meta: {} },
					],
				},
			],
		});

		// A slot can scope by `zone.label` only once the m2o exists.
		await CreateFieldM2O(vendor, {
			collection: SLOT,
			field: 'zone',
			otherCollection: ZONE,
		});

		await request(getUrl(vendor, env))
			.patch(`/collections/${SLOT}`)
			.send({ meta: { scoped_cache_fields: ['owner', 'zone.label'] } })
			.set('Authorization', auth);

		const port = await getPort();
		env[vendor].PORT = String(port);

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(port);
	}, 60_000);

	// Rows a scenario left behind would answer the next one's unfiltered read. The
	// slots go before the zones they point at.
	beforeEach(async () => {
		zoneIds.clear();

		for (const collection of [SLOT, SIGNAL, ZONE]) {
			const existing = await request(getUrl(vendor, env))
				.get(`/items/${collection}`)
				.query({ fields: 'id', limit: '-1' })
				.set('Authorization', auth);

			expect(existing.statusCode).toBe(200);

			const existingIds = existing.body.data.map(
				(row: { id: number }) => row.id,
			);

			if (existingIds.length > 0) {
				const deleted = await request(getUrl(vendor, env))
					.delete(`/items/${collection}`)
					.send(existingIds)
					.set('Authorization', auth);

				expect(deleted.statusCode).toBe(204);
			}
		}
	});

	afterAll(async () => {
		instance.kill();

		await redis.quit();

		await DeleteCollection(vendor, { collection: SLOT });
		await DeleteCollection(vendor, { collection: SIGNAL });
		await DeleteCollection(vendor, { collection: ZONE });
	});

	function cellRows(cell: string): Record<string, unknown>[] {
		return loadYaml(cell) as Record<string, unknown>[];
	}

	// As in `cache-composite-tag.test.ts`: lists go as lists, anything else nested
	// as JSON, so a filter reaches the service as the object the cell states.
	function queryParameters(query: string): Record<string, string | string[]> {
		const parameters: Record<string, string | string[]> = {};
		const sent = loadYaml(query) as Record<string, unknown>;

		for (const [parameter, value] of Object.entries(sent)) {
			if (typeof value === 'string' || Array.isArray(value)) {
				parameters[parameter] = value;
			}
			else {
				parameters[parameter] = JSON.stringify(value);
			}
		}

		return parameters;
	}

	function readSlots(query: Record<string, string | string[]>) {
		return request(getUrl(vendor, env))
			.get(`/items/${SLOT}`)
			.query(query)
			.set('Authorization', auth);
	}

	async function expectCacheStatus(
		query: Record<string, string | string[]>,
		status: 'HIT' | 'MISS',
	) {
		expect((await readSlots(query)).headers[cacheStatusHeader]).toBe(status);
	}

	async function expectAnswer(
		query: Record<string, string | string[]>,
		ids: Map<string, number>,
		expectedAnswer: Record<string, unknown>[],
	) {
		expect((await readSlots(query)).body.data).toMatchObject(
			expectedAnswer.map(({ marker, ...columns }) => {
				return { id: ids.get(marker as string), ...columns };
			}),
		);
	}

	// Every member the slot's scoped-cache index holds, as `<rendered
	// fingerprint>|<cache key>` (`redis-store.ts`). Only the slot's index is read:
	// every fingerprint the feature states is of the slot collection.
	async function indexedMembers(): Promise<Set<string>> {
		const members = new Set<string>();

		const indexKeys = await redis.keys(
			`${env[vendor]['CACHE_NAMESPACE']}:scoped-cache-index:fingerprint:`
			+ `${SLOT}:*`,
		);

		for (const indexKey of indexKeys) {
			for (const member of await redis.smembers(indexKey)) {
				members.add(member);
			}
		}

		return members;
	}

	// Keeps each escape as written, so a part's length is where its separator sat.
	function splitUnescaped(serialized: string, separator: string) {
		const splitParts = [''];

		for (let charAt = 0; charAt < serialized.length; charAt++) {
			if (serialized[charAt] === separator) {
				splitParts.push('');
				continue;
			}

			const escapedLength = serialized[charAt] === '\\'
				? 2
				: 1;

			splitParts[splitParts.length - 1] += serialized
				.slice(charAt, charAt + escapedLength);

			charAt += escapedLength - 1;
		}

		return splitParts;
	}

	// Mirrors `parseScopedCacheFingerprint`, as `cache-composite-tag.test.ts` does:
	// the scenario states the struct and this decodes what was filed, rather than
	// rendering the struct the way production does.
	function decodeFingerprint(rendered: string) {
		const unescaped = (token: string) => token.replace(/\\(.)/g, '$1');

		const colonAt = rendered.includes(':&')
			? rendered.indexOf(':&')
			: rendered.indexOf(':');

		const fingerprintBody = colonAt === -1
			? ''
			: rendered.slice(colonAt + 1);

		const pinnedScope: Record<string, string[]> = {};
		let viewFields: string[] | undefined;

		for (const pin of splitUnescaped(fingerprintBody, '&')) {
			const assignAt = splitUnescaped(pin, ',')[0]!.length - 1;

			if (assignAt < 0 || pin[assignAt] !== '=') {
				continue;
			}

			const field = pin.slice(0, assignAt);

			const tokens = splitUnescaped(pin.slice(assignAt + 1), ',')
				.slice(1, -1)
				.map(unescaped);

			if (field === 'view') {
				viewFields = tokens;
			}
			else {
				pinnedScope[unescaped(field)] = tokens;
			}
		}

		return viewFields === undefined
			? { pinnedScope }
			: { pinnedScope, viewFields };
	}

	const fingerprintOf = (member: string) => splitUnescaped(member, '|')[0]!;

	const cacheKeyOf = (member: string) => {
		return member.slice(fingerprintOf(member).length + 1);
	};

	function expectStatedFingerprints(
		members: string[],
		expectedFingerprints: Record<string, unknown>[],
	) {
		const filed = [...new Set(members.map(fingerprintOf))].map(decodeFingerprint);

		expect(filed).toEqual(expect.arrayContaining(expectedFingerprints));
		expect(expectedFingerprints).toEqual(expect.arrayContaining(filed));
		expect(filed).toHaveLength(expectedFingerprints.length);
	}

	async function expectFingerprints(
		filedBefore: Set<string>,
		expectedFingerprints: Record<string, unknown>[],
	): Promise<string[]> {
		const added = [...await indexedMembers()].filter(
			(member) => !filedBefore.has(member),
		);

		expectStatedFingerprints(added, expectedFingerprints);

		return added;
	}

	// A purge removes the members it matched and no others, so the difference
	// across the signal is the set of fingerprints its declaration reached.
	async function expectPurgedFingerprints(
		filedBefore: Set<string>,
		expectedFingerprints: Record<string, unknown>[],
	) {
		const filedAfter = await indexedMembers();

		expectStatedFingerprints(
			[...filedBefore].filter((member) => !filedAfter.has(member)),
			expectedFingerprints,
		);
	}

	async function expectFiledFingerprints(
		members: string[],
		expectedFingerprints: Record<string, unknown>[],
	) {
		const cacheKeys = new Set(members.map(cacheKeyOf));

		expectStatedFingerprints(
			[...await indexedMembers()].filter(
				(member) => cacheKeys.has(cacheKeyOf(member)),
			),
			expectedFingerprints,
		);
	}

	const queryKey = (query: Record<string, string | string[]>) =>
		JSON.stringify(query);

	async function expectDeclaredFields(table: Record<string, string>[]) {
		const fields = await request(getUrl(vendor, env))
			.get(`/fields/${SLOT}`)
			.set('Authorization', auth);

		const collection = await request(getUrl(vendor, env))
			.get(`/collections/${SLOT}`)
			.set('Authorization', auth);

		const scopedCacheFields: string[]
			= collection.body.data.meta.scoped_cache_fields;

		const declaredFields = fields.body.data
			.filter((field: { field: string }) => field.field !== 'id')
			.map((field: { field: string; type: string }) => {
				const scopedCachePath = scopedCacheFields.find(
					(scopedCacheField) => scopedCacheField.startsWith(`${field.field}.`),
				);

				return {
					field: field.field,
					type: field.type,
					scoped_cache_field: scopedCacheFields.includes(field.field)
						? 'yes'
						: scopedCachePath ?? 'no',
				};
			});

		expect(declaredFields).toEqual(expect.arrayContaining(table));
		expect(declaredFields).toHaveLength(table.length);
	}

	function defineGivenSteps(
		{ given, and }: StepFunctions,
		ids: Map<string, number>,
		filedMembers: Map<string, string[]>,
	) {
		// Asserted rather than created: `beforeAll` creates the collection before the
		// spawn, and a drift fails the Background, not a purge assertion.
		given('the slot collection:', async (table: Record<string, string>[]) => {
			await expectDeclaredFields(table);
		});

		and.optional('the zones:', async (table: Record<string, string>[]) => {
			for (const { marker, label } of table) {
				const response = await request(getUrl(vendor, env))
					.post(`/items/${ZONE}`)
					.send({ label })
					.set('Authorization', auth);

				expect(response.statusCode).toBe(200);
				zoneIds.set(marker!, response.body.data.id);
			}
		});

		and('the slots:', async (table: Record<string, string>[]) => {
			for (const { marker, zone, ...data } of parseGherkinTable<SlotRow>(table)) {
				const response = await request(getUrl(vendor, env))
					.post(`/items/${SLOT}`)
					.send(zone === undefined || zone === null
						? data
						: { ...data, zone: zoneIds.get(zone) })
					.set('Authorization', auth);

				expect(response.statusCode).toBe(200);
				ids.set(marker, response.body.data.id);
			}
		});

		and('this read is cached:', async (table: Record<string, string>[]) => {
			const { query, response, fingerprints } = table[0]!;
			const readQuery = queryParameters(query!);

			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const filedBefore = await indexedMembers();

			// The MISS then HIT proves there is an entry to purge at all.
			expect((await readSlots(readQuery)).headers[cacheStatusHeader])
				.toBe('MISS');

			expect((await readSlots(readQuery)).headers[cacheStatusHeader])
				.toBe('HIT');

			await expectAnswer(readQuery, ids, cellRows(response!));

			filedMembers.set(
				queryKey(readQuery),
				await expectFingerprints(filedBefore, cellRows(fingerprints!)),
			);
		});

		// Filled after the read under test, whose step clears the whole cache.
		and(
			'the witness reads are cached:',
			async (table: Record<string, string>[]) => {
				for (const { query, response, fingerprints } of table) {
					const witnessQuery = queryParameters(query!);
					const filedBefore = await indexedMembers();

					expect((await readSlots(witnessQuery)).headers[cacheStatusHeader])
						.toBe('MISS');

					expect((await readSlots(witnessQuery)).headers[cacheStatusHeader])
						.toBe('HIT');

					await expectAnswer(witnessQuery, ids, cellRows(response!));

					filedMembers.set(
						queryKey(witnessQuery),
						await expectFingerprints(filedBefore, cellRows(fingerprints!)),
					);
				}
			},
		);
	}

	// The `query` cell names the slots the signal rewrites and the note each gets,
	// and `declared` the fingerprints of the slot collection the hook passes to
	// `purgeBy`, which the step completes with the collection.
	function defineWhenSteps({ when }: StepFunctions, ids: Map<string, number>) {
		when(
			'the signal rewrites the slots and declares:',
			async (table: Record<string, string>[]) => {
				const declared = cellRows(table[0]!['declared']!).map(
					(fingerprint) => ({ collection: SLOT, ...fingerprint }),
				);

				const filedBefore = await indexedMembers();

				for (const { marker, note } of cellRows(table[0]!['query']!)) {
					const response = await request(getUrl(vendor, env))
						.post(`/items/${SIGNAL}`)
						.send({
							rewritten_collection: SLOT,
							rewritten_id: ids.get(marker as string),
							rewritten_note: note,
							declared,
						})
						.set('Authorization', auth);

					expect(response.statusCode).toBe(200);
				}

				await expectPurgedFingerprints(
					filedBefore,
					cellRows(table[0]!['purged fingerprints']!),
				);
			},
		);
	}

	function defineThenSteps(
		{ then, and }: StepFunctions,
		ids: Map<string, number>,
		filedMembers: Map<string, string[]>,
	) {
		then(
			/^the read is purged, .+:$/,
			async (table: Record<string, string>[]) => {
				const { query, response, fingerprints } = table[0]!;
				const readQuery = queryParameters(query!);

				await expectCacheStatus(readQuery, 'MISS');
				await expectAnswer(readQuery, ids, cellRows(response!));

				await expectFiledFingerprints(
					filedMembers.get(queryKey(readQuery))!,
					cellRows(fingerprints!),
				);
			},
		);

		and.optional(
			/^the witness reads are purged, .+:$/,
			async (table: Record<string, string>[]) => {
				for (const { query, response, fingerprints } of table) {
					const witnessQuery = queryParameters(query!);

					await expectCacheStatus(witnessQuery, 'MISS');
					await expectAnswer(witnessQuery, ids, cellRows(response!));

					await expectFiledFingerprints(
						filedMembers.get(queryKey(witnessQuery))!,
						cellRows(fingerprints!),
					);
				}
			},
		);

		and(
			/^the witness reads are still cached, .+:$/,
			async (table: Record<string, string>[]) => {
				for (const { query, response, fingerprints } of table) {
					const witnessQuery = queryParameters(query!);

					await expectCacheStatus(witnessQuery, 'HIT');
					await expectAnswer(witnessQuery, ids, cellRows(response!));

					await expectFiledFingerprints(
						filedMembers.get(queryKey(witnessQuery))!,
						cellRows(fingerprints!),
					);
				}
			},
		);
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'a purge declared on a dotted path in another case purges the read',
			(steps) => {
				const ids = new Map<string, number>();
				const filedMembers = new Map<string, string[]>();

				defineGivenSteps(steps, ids, filedMembers);

				defineWhenSteps(steps, ids);

				defineThenSteps(steps, ids, filedMembers);
			},
			60_000,
		);

		scenario(
			'a purge declared on a value purges the reads pinning nothing',
			(steps) => {
				const ids = new Map<string, number>();
				const filedMembers = new Map<string, string[]>();

				defineGivenSteps(steps, ids, filedMembers);

				defineWhenSteps(steps, ids);

				defineThenSteps(steps, ids, filedMembers);
			},
			60_000,
		);
	});
});
