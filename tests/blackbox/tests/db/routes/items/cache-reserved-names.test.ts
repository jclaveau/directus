import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	type StepFunctions,
} from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
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

// Directus refuses neither name: a collection needs only a non-empty name off
// the `directus_` prefix, and a field any string at all.
const EQUALS_FIELD_COLLECTION = 'reserved_name_field';
const PIPE_COLLECTION = 'reserved_name|pipe';

const COLLECTIONS = [EQUALS_FIELD_COLLECTION, PIPE_COLLECTION];

const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature(
	'./tests/db/routes/items/cache-reserved-names.feature',
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
	env[vendor]['CACHE_NAMESPACE'] = `directus-reserved-names-${vendor}`;

	let instance: ChildProcess;

	// The fingerprints are read back out of the index the spawned instance writes.
	const redis = new Redis({
		host: env[vendor]['REDIS_HOST'],
		port: Number(env[vendor]['REDIS_PORT']),
	});

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	beforeAll(async () => {
		// The scoped instance reads `scoped_cache_fields` off the schema it boots on,
		// so the collections precede the spawn.
		await CreateCollections(vendor, {
			collections: [
				{
					collection: EQUALS_FIELD_COLLECTION,
					meta: { scoped_cache_fields: ['a=b'] },
					fields: [
						{ field: 'a=b', type: 'string', meta: {} },
						{ field: 'note', type: 'string', meta: {} },
					],
				},
				{
					collection: PIPE_COLLECTION,
					meta: { scoped_cache_fields: ['owner'] },
					fields: [
						{ field: 'owner', type: 'string', meta: {} },
						{ field: 'note', type: 'string', meta: {} },
					],
				},
			],
		});

		const port = await getPort();
		env[vendor].PORT = String(port);

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(port);
	}, 60_000);

	beforeEach(async () => {
		for (const collection of COLLECTIONS) {
			const existing = await request(getUrl(vendor, env))
				.get(`/items/${encodeURIComponent(collection)}`)
				.query({ fields: 'id', limit: '-1' })
				.set('Authorization', auth);

			expect(existing.statusCode).toBe(200);

			const existingIds = existing.body.data.map(
				(row: { id: number }) => row.id,
			);

			if (existingIds.length > 0) {
				const deleted = await request(getUrl(vendor, env))
					.delete(`/items/${encodeURIComponent(collection)}`)
					.send(existingIds)
					.set('Authorization', auth);

				expect(deleted.statusCode).toBe(204);
			}
		}
	});

	afterAll(async () => {
		instance.kill();

		await redis.quit();

		for (const collection of COLLECTIONS) {
			await DeleteCollection(vendor, {
				collection: encodeURIComponent(collection),
			});
		}
	});

	function cellRows(cell: string): Record<string, unknown>[] {
		return loadYaml(cell) as Record<string, unknown>[];
	}

	// `fields` is a list over the wire; a nested filter goes as JSON, which
	// Directus parses natively.
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

	async function expectRead(
		collection: string,
		query: Record<string, string | string[]>,
		status: 'HIT' | 'MISS',
		expectedAnswer: Record<string, unknown>[],
		ids: Map<string, number>,
	) {
		const response = await request(getUrl(vendor, env))
			.get(`/items/${encodeURIComponent(collection)}`)
			.query(query)
			.set('Authorization', auth);

		expect(response.headers[cacheStatusHeader]).toBe(status);

		expect(response.body.data).toEqual(
			expectedAnswer.map(({ marker, ...columns }) => {
				return expect.objectContaining({
					id: ids.get(marker as string),
					...columns,
				});
			}),
		);
	}

	// Every member of one collection's scoped-cache index, as `<rendered
	// fingerprint>|<cache key>` (`redis-store.ts`). The index key holds the
	// collection as it is named.
	async function indexedMembers(collection: string): Promise<Set<string>> {
		const members = new Set<string>();

		const indexKeys = await redis.keys(
			`${env[vendor]['CACHE_NAMESPACE']}:scoped-cache-index:fingerprint:`
			+ `${collection}:*`,
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

	// Mirrors `parseScopedCacheFingerprint`, which this suite cannot import: the
	// collection ends at `:&` and is unescaped, a key ends at the `=` before its
	// first unescaped comma — so a field named `a=b` keeps its whole name.
	function decodeFingerprint(rendered: string) {
		const unescaped = (token: string) => token.replace(/\\(.)/g, '$1');
		const colonAt = rendered.indexOf(':&');

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

		return {
			collection: unescaped(colonAt === -1
				? rendered
				: rendered.slice(0, colonAt)),
			...viewFields === undefined
				? { pinnedScope }
				: { pinnedScope, viewFields },
		};
	}

	// The fingerprints the members added by one filling request were filed under.
	async function expectFingerprints(
		collection: string,
		filedBefore: Set<string>,
		expectedFingerprints: Record<string, unknown>[],
	) {
		const added = [...await indexedMembers(collection)].filter(
			(member) => !filedBefore.has(member),
		);

		const filed = [
			...new Set(added.map((member) => splitUnescaped(member, '|')[0]!)),
		].map(decodeFingerprint);

		expect(filed).toEqual(expect.arrayContaining(expectedFingerprints));
		expect(filed).toHaveLength(expectedFingerprints.length);
	}

	async function expectCachedRead(
		collection: string,
		{ query, response, fingerprints }: Record<string, string>,
		ids: Map<string, number>,
	) {
		const readQuery = queryParameters(query!);
		const filedBefore = await indexedMembers(collection);

		// The MISS then HIT proves there is an entry to purge at all.
		await expectRead(collection, readQuery, 'MISS', cellRows(response!), ids);
		await expectRead(collection, readQuery, 'HIT', cellRows(response!), ids);

		await expectFingerprints(collection, filedBefore, cellRows(fingerprints!));
	}

	function defineGivenSteps(
		{ given, and }: StepFunctions,
		ids: Map<string, number>,
	) {
		// Asserted rather than created: `beforeAll` builds the schema before the
		// spawn, and a drift fails the Background, not a purge assertion.
		given('the collections:', async (table: Record<string, string>[]) => {
			const declaredFields: Record<string, string>[] = [];

			for (const collectionName of COLLECTIONS) {
				const fields = await request(getUrl(vendor, env))
					.get(`/fields/${encodeURIComponent(collectionName)}`)
					.set('Authorization', auth);

				const collection = await request(getUrl(vendor, env))
					.get(`/collections/${encodeURIComponent(collectionName)}`)
					.set('Authorization', auth);

				const scopedCacheFields: string[]
					= collection.body.data.meta.scoped_cache_fields ?? [];

				for (const field of fields.body.data) {
					if (field.field === 'id') {
						continue;
					}

					declaredFields.push({
						collection: collectionName,
						field: field.field,
						type: field.type,
						scoped_cache_field: scopedCacheFields.includes(field.field)
							? 'yes'
							: 'no',
					});
				}
			}

			expect(declaredFields).toEqual(expect.arrayContaining(table));
			expect(declaredFields).toHaveLength(table.length);
		});

		and(
			/^the rows of (\S+):$/,
			async (collection: string, table: Record<string, string>[]) => {
				for (const { marker, data } of table) {
					const response = await request(getUrl(vendor, env))
						.post(`/items/${encodeURIComponent(collection)}`)
						.send(loadYaml(data!) as Record<string, unknown>)
						.set('Authorization', auth);

					expect(response.statusCode).toBe(200);
					ids.set(marker!, response.body.data.id);
				}
			},
		);

		and(
			/^this read of (\S+) is cached:$/,
			async (collection: string, table: Record<string, string>[]) => {
				await request(getUrl(vendor, env))
					.post('/utils/cache/clear')
					.set('Authorization', auth);

				await expectCachedRead(collection, table[0]!, ids);
			},
		);

		// Filled after the read under test, whose step clears the whole cache.
		and(
			/^the witness reads of (\S+) are cached:$/,
			async (collection: string, table: Record<string, string>[]) => {
				for (const row of table) {
					await expectCachedRead(collection, row, ids);
				}
			},
		);
	}

	function defineWhenSteps({ when }: StepFunctions, ids: Map<string, number>) {
		when(
			/^the (\S+) rows are updated:$/,
			async (collection: string, table: Record<string, string>[]) => {
				for (const { marker, data } of table) {
					const response = await request(getUrl(vendor, env))
						.patch(
							`/items/${encodeURIComponent(collection)}/${ids.get(marker!)}`,
						)
						.send(loadYaml(data!) as Record<string, unknown>)
						.set('Authorization', auth);

					expect(response.statusCode).toBe(200);
				}
			},
		);
	}

	function defineThenSteps(
		{ then, and }: StepFunctions,
		ids: Map<string, number>,
		collection: string,
	) {
		then(
			/^the read is purged, .+:$/,
			async (table: Record<string, string>[]) => {
				const { query, response } = table[0]!;

				await expectRead(
					collection,
					queryParameters(query!),
					'MISS',
					cellRows(response!),
					ids,
				);
			},
		);

		and(
			/^the witness reads are still cached, .+:$/,
			async (table: Record<string, string>[]) => {
				for (const { query, response } of table) {
					await expectRead(
						collection,
						queryParameters(query!),
						'HIT',
						cellRows(response!),
						ids,
					);
				}
			},
		);
	}

	function defineScenarioSteps(steps: StepFunctions, collection: string) {
		const ids = new Map<string, number>();

		defineGivenSteps(steps, ids);
		defineWhenSteps(steps, ids);
		defineThenSteps(steps, ids, collection);
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'a write to a field named with an equals sign purges the read pinned on'
				+ ' it',
			(steps) => defineScenarioSteps(steps, EQUALS_FIELD_COLLECTION),
			60_000,
		);

		scenario(
			'a write to a collection named with a pipe purges the read pinned on it',
			(steps) => defineScenarioSteps(steps, PIPE_COLLECTION),
			60_000,
		);
	});
});
