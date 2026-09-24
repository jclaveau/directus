import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
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

const SLOT = 'composite_tag_slot';
const cacheStatusHeader = 'x-cache-status';

type SlotRow = {
	marker: string;
	owner: string;
	method: string;
	note: string;
	amount: number;
};

const feature = loadFeature(
	'./tests/db/routes/items/cache-composite-tag.feature',
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
	env[vendor]['CACHE_NAMESPACE'] = `directus-composite-tag-${vendor}`;

	let instance: ChildProcess;

	// The scoped-cache index lives in the Redis the spawned instance writes to, and
	// reading it back is how a scenario states what a read was filed under.
	const redis = new Redis({
		host: env[vendor]['REDIS_HOST'],
		port: Number(env[vendor]['REDIS_PORT']),
	});

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	beforeAll(async () => {
		// The scoped instance reads `scoped_cache_fields` off the schema it boots on,
		// so the collection precedes the spawn.
		await CreateCollections(vendor, {
			collections: [
				{
					collection: SLOT,
					meta: { scoped_cache_fields: ['owner', 'method'] },
					fields: [
						{ field: 'owner', type: 'string', meta: {} },
						{ field: 'method', type: 'string', meta: {} },
						{ field: 'note', type: 'string', meta: {} },
						{ field: 'amount', type: 'integer', meta: {} },
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

	// A scenario states the rows it starts from, and all fifteen read the one
	// collection: rows a scenario left behind answer the next one's read. A filter
	// pinning an owner no other scenario uses hides that, an `_or` branch bound to
	// a shared `method` does not — it answered with every row the file had created
	// so far.
	beforeEach(async () => {
		const existing = await request(getUrl(vendor, env))
			.get(`/items/${SLOT}`)
			.query({ fields: 'id', limit: '-1' })
			.set('Authorization', auth);

		const existingIds = existing.body.data.map((row: { id: number }) => row.id);

		if (existingIds.length > 0) {
			await request(getUrl(vendor, env))
				.delete(`/items/${SLOT}`)
				.send(existingIds)
				.set('Authorization', auth);
		}
	});

	afterAll(async () => {
		instance.kill();

		await redis.quit();

		await DeleteCollection(vendor, { collection: SLOT });
	});

	// A written row names itself by the marker the scenario files it under, and
	// carries under `data` the body its request sends: every column on a create,
	// the ones it changes on an update, none at all on a delete.
	type WrittenSlot = { marker: string; data?: Partial<SlotRow> };

	async function createSlots(rows: WrittenSlot[], ids: Map<string, number>) {
		for (const { marker, data } of rows) {
			const response = await request(getUrl(vendor, env))
				.post(`/items/${SLOT}`)
				.send(data)
				.set('Authorization', auth);

			expect(response.statusCode).toBe(200);
			ids.set(marker, response.body.data.id);
		}
	}

	async function updateSlots(rows: WrittenSlot[], ids: Map<string, number>) {
		for (const { marker, data } of rows) {
			const response = await request(getUrl(vendor, env))
				.patch(`/items/${SLOT}/${ids.get(marker)}`)
				.send(data)
				.set('Authorization', auth);

			expect(response.statusCode).toBe(200);
		}
	}

	async function deleteSlots(rows: WrittenSlot[], ids: Map<string, number>) {
		for (const { marker } of rows) {
			const response = await request(getUrl(vendor, env))
				.delete(`/items/${SLOT}/${ids.get(marker)}`)
				.set('Authorization', auth);

			expect(response.statusCode).toBe(204);
		}
	}

	// A cell is YAML rather than JSON, which spends a line on every brace: the
	// fork's multiline notation dedents a cell as a block, so the indentation the
	// reader sees is the one the parser reads.
	function cellRows(cell: string): Record<string, unknown>[] {
		return loadYaml(cell) as Record<string, unknown>[];
	}

	// A `query` cell holds the `Query` the read is made of, so a scenario states
	// its pins as the object the service receives rather than as a URL encoding of
	// one. `fields`, `sort` and `groupBy` are lists over the wire and go as lists;
	// anything else nested goes as JSON, which Directus parses natively
	// (`sanitize-query.ts`): superagent stringifies with `indices: false`, which
	// would fold an `_or` array's branches into a single object and turn the
	// alternatives into a conjunction.
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

	// An expected answer names its rows by the marker the scenario created them
	// under, so a scenario reads as rows in, rows out, with no id carried across its
	// steps, and holds only the columns that carry its point.
	async function expectAnswer(
		query: Record<string, string | string[]>,
		ids: Map<string, number>,
		expectedAnswer: Record<string, unknown>[],
	) {
		const markerById = new Map<number, string>();

		for (const [marker, id] of ids) {
			markerById.set(id, marker);
		}

		if (expectedAnswer.length === 0) {
			expect((await readSlots(query)).body.data).toEqual([]);
			return;
		}

		const columns = Object.keys(expectedAnswer[0]!);

		const answered = (await readSlots(query)).body.data.map(
			(row: Record<string, unknown>) => {
				const answer: Record<string, unknown> = {};

				for (const column of columns) {
					answer[column] = column === 'marker'
						? markerById.get(row['id'] as number)
						: row[column];
				}

				return answer;
			},
		);

		expect(answered).toEqual(expect.arrayContaining(expectedAnswer));
		expect(answered).toHaveLength(expectedAnswer.length);
	}

	// Every member the scoped-cache index holds for this collection, as
	// `<rendered fingerprint>|<cache key>` (`redis-store.ts`). Filling one entry
	// adds its own members and no others, so what a read is filed under is the
	// difference across the request that filled it -- which needs no cache key,
	// and so no readable one.
	async function indexedMembers(): Promise<Set<string>> {
		const indexKeys = await redis.keys(
			`${env[vendor]['CACHE_NAMESPACE']}:scoped-cache-index:fingerprint:`
			+ `${SLOT}:*`,
		);

		const members = new Set<string>();

		for (const indexKey of indexKeys) {
			for (const member of await redis.smembers(indexKey)) {
				members.add(member);
			}
		}

		return members;
	}

	// The grammar Redis holds a fingerprint in, read back: `<collection>:&<field>=,
	// <value>,&...&`, every reserved character backslash-escaped, with the view
	// riding as a pin named `view`. The scenario states the struct and this decodes
	// what was filed, rather than rendering the struct the way production does --
	// a renderer here would agree with a renderer's own bug.
	function decodeFingerprint(rendered: string) {
		const unescaped = (token: string) => token.replace(/\\(.)/g, '$1');
		const [, ...pins] = rendered.match(/(?:\\.|[^&])+/g) ?? [];
		const pinnedScope: Record<string, string[]> = {};
		let viewFields: string[] | undefined;

		for (const pin of pins) {
			const [field, values] = pin.split(/(?<!\\)=/);
			const tokens = (values?.match(/(?:\\.|[^,])+/g) ?? []).map(unescaped);

			if (unescaped(field!) === 'view') {
				viewFields = tokens;
			}
			else {
				pinnedScope[unescaped(field!)] = tokens;
			}
		}

		return viewFields === undefined
			? { pinnedScope }
			: { pinnedScope, viewFields };
	}

	// An index member joins the fingerprint it was filed under to the cache key it
	// names, and only the fingerprint half is ever stated: a scenario says what a
	// read is filed under, never where the entry lives.
	const fingerprintOf = (member: string) => member.split(/(?<!\\)\|/)[0]!;

	function expectStatedFingerprints(
		members: string[],
		expectedFingerprints: Record<string, unknown>[],
	) {
		const filed = [...new Set(members.map(fingerprintOf))].map(decodeFingerprint);

		expect(filed).toEqual(expect.arrayContaining(expectedFingerprints));
		expect(filed).toHaveLength(expectedFingerprints.length);
	}

	// The fingerprints a `fingerprints` cell states, against the ones the entry
	// filled by this request was filed under. They carry no collection: every read
	// in this feature is of the one the Background declares. The members go back to
	// the caller, which is how a later step names that entry again.
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

	// What a write dropped from the index. A purge removes the members it matched
	// and no others (`purge.ts` purgeScopedCacheIndexWhere), so the difference
	// across the write is the set of fingerprints it reached — and an entry filed
	// under two, one of which the row holds on, loses only that one.
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

	// The fingerprints an entry is filed under once the step's read has settled:
	// the members recorded when the scenario cached that read, which a purge prunes
	// and the refill puts back under the same cache key. An entry the write left
	// alone and one it purged both end their step filed under what they state.
	async function expectFiledFingerprints(
		members: string[],
		expectedFingerprints: Record<string, unknown>[],
	) {
		const indexed = await indexedMembers();

		expect(members.filter((member) => !indexed.has(member))).toEqual([]);

		expectStatedFingerprints(members, expectedFingerprints);
	}

	// What a read is filed under in `filedMembers`. The query is the one thing a
	// step after the write still holds of the read it is about, and it is enough:
	// two reads sending the same query are one entry.
	const queryKey = (query: Record<string, string | string[]>) =>
		JSON.stringify(query);

	function defineGivenSteps(
		{ given, and }: StepFunctions,
		ids: Map<string, number>,
		filedMembers: Map<string, string[]>,
	) {
		// The schema the scenarios read against, asserted rather than created here:
		// the instance reads `scoped_cache_fields` off the schema it boots on, so
		// `beforeAll` creates the collection before the spawn. The feature still
		// states it, and a drift fails the Background, not a purge assertion.
		given('the slot collection:', async (table: Record<string, string>[]) => {
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
					return {
						field: field.field,
						type: field.type,
						scoped_cache_field: scopedCacheFields.includes(field.field)
							? 'yes'
							: 'no',
					};
				});

			expect(declaredFields).toEqual(expect.arrayContaining(table));
			expect(declaredFields).toHaveLength(table.length);
		});

		// The starting rows stand in an ordinary table, one column per field, while
		// a written row states its body under `data`: the marker names the row, and
		// every other column is the body creating it sends.
		and('the slots:', async (table: Record<string, string>[]) => {
			await createSlots(
				parseGherkinTable<SlotRow>(table).map(
					({ marker, ...data }) => ({ marker, data }),
				),
				ids,
			);
		});

		// The query is the scenario's own table, so a reader sees what is cached
		// where the scenario says it is cached, and the `Then` reads it back.
		and('this read is cached:', async (table: Record<string, string>[]) => {
			const { query, response, fingerprints } = table[0]!;
			const readQuery = queryParameters(query!);

			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const filedBefore = await indexedMembers();

			// The MISS then HIT proves there is an entry to purge at all: a
			// scenario asserting a later HIT would pass just as well against a read
			// that was never cacheable.
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

		// Filled after the read under test, because that step clears the whole cache
		// before it fills its own entry, and the witnesses have to outlive it.
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

	// A write states the rows it writes and the fingerprints it dropped from the
	// index, so the three mutations differ only in the verb and in the `data` a row
	// of the `query` cell carries.
	function defineWhenSteps({ when }: StepFunctions, ids: Map<string, number>) {
		when.optional(
			'the slots are created:',
			async (table: Record<string, string>[]) => {
				const filedBefore = await indexedMembers();

				await createSlots(
					cellRows(table[0]!['query']!) as WrittenSlot[],
					ids,
				);

				await expectPurgedFingerprints(
					filedBefore,
					cellRows(table[0]!['purged fingerprints']!),
				);
			},
		);

		when.optional(
			'the slots are updated:',
			async (table: Record<string, string>[]) => {
				const filedBefore = await indexedMembers();

				await updateSlots(
					cellRows(table[0]!['query']!) as WrittenSlot[],
					ids,
				);

				await expectPurgedFingerprints(
					filedBefore,
					cellRows(table[0]!['purged fingerprints']!),
				);
			},
		);

		when.optional(
			'the slots are deleted:',
			async (table: Record<string, string>[]) => {
				const filedBefore = await indexedMembers();

				await deleteSlots(
					cellRows(table[0]!['query']!) as WrittenSlot[],
					ids,
				);

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
		then.optional(
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

		then.optional(
			/^the read is still cached, .+:$/,
			async (table: Record<string, string>[]) => {
				const { query, response, fingerprints } = table[0]!;
				const readQuery = queryParameters(query!);

				await expectCacheStatus(readQuery, 'HIT');
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

		and.optional(
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
			'a write matching one pin but not the other leaves the read cached',
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
			'a write matching every pin purges the read',
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
			'a write changing a field the read never named leaves it cached',
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
			'a write changing a field the read sorted on purges it',
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
			'a read selecting every field is purged by any column change',
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
			'a read filtered on a range binds the field without pinning a value',
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
			'a write to the field a range was read on purges it',
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
			'a read filtered on a list of owners is purged by a write to any of them',
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
			'a read filtered on a list of owners survives a write outside it',
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
			"a row moving into the read's slice purges it",
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
			"a row moving out of the read's slice purges it",
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
			'a read matching two ways is purged by a write matching either',
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
			'a read matching two ways survives a write matching neither',
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
			'a delete of a matching row purges the read',
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
			"a delete outside the read's slice leaves it cached",
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
