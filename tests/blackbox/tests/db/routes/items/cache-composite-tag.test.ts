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

const SLOT = 'composite_tag_slot';
const METHOD_RANGE = 'composite_tag_method_range';

// The production layout, where the slot declares only its foreign keys and the
// path to each value composes off the scope its parent declares.
const PATH_PART = 'composite_path_part';
const PATH_RANGE = 'composite_path_range';
const PATH_SLOT = 'composite_path_slot';

const cacheStatusHeader = 'x-cache-status';

type SlotRow = {
	marker: string;
	owner: string;
	method: string;
	method_range: string;
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

	// A slot names its method range by the marker the range was created under,
	// and a path slot its parents the same way; `beforeEach` drops them all.
	const methodRangeIds = new Map<string, number>();
	const pathPartIds = new Map<string, number>();
	const pathRangeIds = new Map<string, number>();

	beforeAll(async () => {
		// The scoped instance reads `scoped_cache_fields` off the schema it boots on,
		// so the collection precedes the spawn.
		await CreateCollections(vendor, {
			collections: [
				{
					collection: SLOT,
					fields: [
						{ field: 'owner', type: 'string', meta: {} },
						{ field: 'method', type: 'string', meta: {} },
						{ field: 'note', type: 'string', meta: {} },
						{ field: 'amount', type: 'integer', meta: {} },
					],
				},
				{
					collection: METHOD_RANGE,
					fields: [{ field: 'method', type: 'string', meta: {} }],
				},
			],
		});

		// A slot can scope by `method_range.method` only once the m2o exists, so the
		// scope fields are set after the field is created.
		await CreateFieldM2O(vendor, {
			collection: SLOT,
			field: 'method_range',
			otherCollection: METHOD_RANGE,
		});

		await request(getUrl(vendor, env))
			.patch(`/collections/${SLOT}`)
			.send({
				meta: {
					scoped_cache_fields: ['owner', 'method', 'method_range.method'],
				},
			})
			.set('Authorization', auth);

		await CreateCollections(vendor, {
			collections: [
				{
					collection: PATH_PART,
					meta: { scoped_cache_fields: ['owner'] },
					fields: [{ field: 'owner', type: 'string', meta: {} }],
				},
				{
					collection: PATH_RANGE,
					meta: { scoped_cache_fields: ['method'] },
					fields: [{ field: 'method', type: 'string', meta: {} }],
				},
				{
					collection: PATH_SLOT,
					fields: [{ field: 'note', type: 'string', meta: {} }],
				},
			],
		});

		await CreateFieldM2O(vendor, {
			collection: PATH_SLOT,
			field: 'course_part',
			otherCollection: PATH_PART,
		});

		await CreateFieldM2O(vendor, {
			collection: PATH_SLOT,
			field: 'method_range',
			otherCollection: PATH_RANGE,
		});

		await request(getUrl(vendor, env))
			.patch(`/collections/${PATH_SLOT}`)
			.send({ meta: { scoped_cache_fields: ['course_part', 'method_range'] } })
			.set('Authorization', auth);

		const port = await getPort();
		env[vendor].PORT = String(port);

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(port);
	}, 60_000);

	// A scenario states the rows it starts from, and seventeen read the one
	// collection: rows a scenario left behind answer the next one's read. A filter
	// pinning an owner no other scenario uses hides that, an `_or` branch bound to
	// a shared `method` does not — it answered with every row the file had created
	// so far. The slots go before the ranges and parts they point at, and so do
	// the markers naming them.
	beforeEach(async () => {
		methodRangeIds.clear();
		pathPartIds.clear();
		pathRangeIds.clear();

		for (const collection of [
			SLOT,
			METHOD_RANGE,
			PATH_SLOT,
			PATH_PART,
			PATH_RANGE,
		]) {
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
		await DeleteCollection(vendor, { collection: METHOD_RANGE });
		await DeleteCollection(vendor, { collection: PATH_SLOT });
		await DeleteCollection(vendor, { collection: PATH_PART });
		await DeleteCollection(vendor, { collection: PATH_RANGE });
	});

	// A written row names itself by the marker the scenario files it under, and
	// carries under `data` the body its request sends: every column on a create,
	// the ones it changes on an update, none at all on a delete.
	type WrittenSlot = { marker: string; data?: Partial<SlotRow> };

	async function createSlots(rows: WrittenSlot[], ids: Map<string, number>) {
		for (const { marker, data } of rows) {
			const response = await request(getUrl(vendor, env))
				.post(`/items/${SLOT}`)
				.send(data?.method_range === undefined
					? data
					: { ...data, method_range: methodRangeIds.get(data.method_range) })
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

	type PathSlotRow = {
		course_part: string;
		method_range: string;
		note: string;
	};

	type WrittenPathSlot = { marker: string; data: PathSlotRow };

	async function createPathSlots(
		rows: WrittenPathSlot[],
		ids: Map<string, number>,
	) {
		for (const { marker, data } of rows) {
			const response = await request(getUrl(vendor, env))
				.post(`/items/${PATH_SLOT}`)
				.send({
					...data,
					course_part: pathPartIds.get(data.course_part),
					method_range: pathRangeIds.get(data.method_range),
				})
				.set('Authorization', auth);

			expect(response.statusCode).toBe(200);
			ids.set(marker, response.body.data.id);
		}
	}

	type WrittenPathRange = { marker: string; data: { method: string } };

	async function updatePathRanges(rows: WrittenPathRange[]) {
		for (const { marker, data } of rows) {
			const response = await request(getUrl(vendor, env))
				.patch(`/items/${PATH_RANGE}/${pathRangeIds.get(marker)}`)
				.send(data)
				.set('Authorization', auth);

			expect(response.statusCode).toBe(200);
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

	// The Background's collection unless a path scenario names its own.
	function readSlots(
		query: Record<string, string | string[]>,
		collection: string = SLOT,
	) {
		return request(getUrl(vendor, env))
			.get(`/items/${collection}`)
			.query(query)
			.set('Authorization', auth);
	}

	async function expectCacheStatus(
		query: Record<string, string | string[]>,
		status: 'HIT' | 'MISS',
		collection: string,
	) {
		expect((await readSlots(query, collection)).headers[cacheStatusHeader])
			.toBe(status);
	}

	// An expected answer names its rows by the marker the scenario created them
	// under, so a scenario reads as rows in, rows out, with no id carried across its
	// steps, and holds only the columns that carry its point, in the order the
	// read answers them.
	async function expectAnswer(
		query: Record<string, string | string[]>,
		ids: Map<string, number>,
		expectedAnswer: Record<string, unknown>[],
		collection: string,
	) {
		expect((await readSlots(query, collection)).body.data).toMatchObject(
			expectedAnswer.map(({ marker, ...columns }) => {
				return { id: ids.get(marker as string), ...columns };
			}),
		);
	}

	// Every member the scoped-cache index holds for the collections a scenario
	// states fingerprints of, as `<rendered fingerprint>|<cache key>`
	// (`redis-store.ts`). Filling one entry adds its own members and no others, so
	// what a read is filed under is the difference across the request that filled
	// it -- which needs no cache key, and so no readable one. A path read touches
	// three collections and a write to either parent purges through its own index,
	// so theirs are read too; nothing but a path scenario reads them.
	async function indexedMembers(): Promise<Set<string>> {
		const members = new Set<string>();

		for (const collection of [SLOT, PATH_SLOT, PATH_PART, PATH_RANGE]) {
			const indexKeys = await redis.keys(
				`${env[vendor]['CACHE_NAMESPACE']}:scoped-cache-index:fingerprint:`
				+ `${collection}:*`,
			);

			for (const indexKey of indexKeys) {
				for (const member of await redis.smembers(indexKey)) {
					members.add(member);
				}
			}
		}

		return members;
	}

	// The grammar Redis holds a fingerprint in, read back: `<collection>:&<field>=,
	// <value>,&...&`, every reserved character backslash-escaped, with the view
	// riding as a pin named `view`. The scenario states the struct and this decodes
	// what was filed, rather than rendering the struct the way production does --
	// a renderer here would agree with a renderer's own bug. A fingerprint of the
	// Background's collection carries no `collection`, the way the feature states
	// it; any other names the one it was filed for.
	// A read showing a parent's columns is also filed under that parent's primary
	// key, which the database picked; a scenario names the row by its marker.
	const parentIds = new Map([
		[PATH_PART, pathPartIds],
		[PATH_RANGE, pathRangeIds],
	]);

	function parentMarker(collection: string, id: string) {
		for (const [marker, parentId] of parentIds.get(collection)!) {
			if (String(parentId) === id) {
				return marker;
			}
		}

		return id;
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
	// collection ends at `:&`, a key at the `=` before its first unescaped comma,
	// and `,,` is one empty value.
	function decodeFingerprint(rendered: string) {
		const unescaped = (token: string) => token.replace(/\\(.)/g, '$1');

		const colonAt = rendered.includes(':&')
			? rendered.indexOf(':&')
			: rendered.indexOf(':');

		const collection = colonAt === -1
			? rendered
			: rendered.slice(0, colonAt);

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
			else if (unescaped(field) === 'id' && parentIds.has(collection)) {
				pinnedScope['id'] = tokens.map((id) => parentMarker(collection, id));
			}
			else {
				pinnedScope[unescaped(field)] = tokens;
			}
		}

		const fingerprint = viewFields === undefined
			? { pinnedScope }
			: { pinnedScope, viewFields };

		return collection === SLOT
			? fingerprint
			: { collection, ...fingerprint };
	}

	// An index member joins the fingerprint it was filed under to the cache key it
	// names, and only the fingerprint half is ever stated: a scenario says what a
	// read is filed under, never where the entry lives.
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
	// every member under the cache key recorded when the scenario cached that read,
	// which a purge prunes where it matched and the refill files again. A member the
	// purge did not match outlives the entry it named, so a parent row the refill no
	// longer shows can still be pinned
	// (https://github.com/jclaveau/directus/issues/547).
	// An entry the write left alone and one it purged both end their step filed
	// under what they state.
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

	// What a read is filed under in `filedMembers`. The query is the one thing a
	// step after the write still holds of the read it is about, and it is enough:
	// two reads sending the same query are one entry.
	const queryKey = (query: Record<string, string | string[]>) =>
		JSON.stringify(query);

	function defineBackgroundSteps(given: StepFunctions['given']) {
		// The schema the scenarios read against, asserted rather than created here:
		// the instance reads `scoped_cache_fields` off the schema it boots on, so
		// `beforeAll` creates the collection before the spawn. The feature still
		// states it, and a drift fails the Background, not a purge assertion.
		given('the slot collection:', async (table: Record<string, string>[]) => {
			await expectDeclaredFields(SLOT, table);
		});
	}

	async function expectDeclaredFields(
		collectionName: string,
		table: Record<string, string>[],
	) {
		const fields = await request(getUrl(vendor, env))
			.get(`/fields/${collectionName}`)
			.set('Authorization', auth);

		const collection = await request(getUrl(vendor, env))
			.get(`/collections/${collectionName}`)
			.set('Authorization', auth);

		const scopedCacheFields: string[]
			= collection.body.data.meta.scoped_cache_fields;

		const declaredFields = fields.body.data
			.filter((field: { field: string }) => field.field !== 'id')
			.map((field: { field: string; type: string }) => {
				// A relation declared by the path through it names that path; declared
				// by its key alone it reads `yes`, and composes off the parent's scope.
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
		defineBackgroundSteps(given);

		// The ranges a slot's `method_range` names, created before the slots that
		// point at them.
		and.optional('the method ranges:', async (table: Record<string, string>[]) => {
			for (const { marker, method } of table) {
				const response = await request(getUrl(vendor, env))
					.post(`/items/${METHOD_RANGE}`)
					.send({ method })
					.set('Authorization', auth);

				expect(response.statusCode).toBe(200);
				methodRangeIds.set(marker!, response.body.data.id);
			}
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

		defineCachedReadSteps(and, ids, filedMembers, SLOT);
	}

	// The read under test and its witnesses, of the collection a scenario reads.
	function defineCachedReadSteps(
		and: StepFunctions['and'],
		ids: Map<string, number>,
		filedMembers: Map<string, string[]>,
		collection: string,
	) {
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
			expect(
				(await readSlots(readQuery, collection)).headers[cacheStatusHeader],
			).toBe('MISS');

			expect(
				(await readSlots(readQuery, collection)).headers[cacheStatusHeader],
			).toBe('HIT');

			await expectAnswer(readQuery, ids, cellRows(response!), collection);

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

					expect(
						(await readSlots(witnessQuery, collection)).headers[cacheStatusHeader],
					).toBe('MISS');

					expect(
						(await readSlots(witnessQuery, collection)).headers[cacheStatusHeader],
					).toBe('HIT');

					await expectAnswer(
						witnessQuery,
						ids,
						cellRows(response!),
						collection,
					);

					filedMembers.set(
						queryKey(witnessQuery),
						await expectFingerprints(filedBefore, cellRows(fingerprints!)),
					);
				}
			},
		);
	}

	// The production layout: the slot declares its two foreign keys and nothing
	// past them, each parent declares its own column, and the paths
	// `course_part.owner` and `method_range.method` compose off the two.
	function definePathGivenSteps(
		{ given, and }: StepFunctions,
		ids: Map<string, number>,
		filedMembers: Map<string, string[]>,
	) {
		defineBackgroundSteps(given);

		and(
			'the course part collection:',
			async (table: Record<string, string>[]) => {
				await expectDeclaredFields(PATH_PART, table);
			},
		);

		and(
			'the method range collection:',
			async (table: Record<string, string>[]) => {
				await expectDeclaredFields(PATH_RANGE, table);
			},
		);

		and(
			'the composed slot collection:',
			async (table: Record<string, string>[]) => {
				await expectDeclaredFields(PATH_SLOT, table);
			},
		);

		and('the course parts:', async (table: Record<string, string>[]) => {
			for (const { marker, owner } of table) {
				const response = await request(getUrl(vendor, env))
					.post(`/items/${PATH_PART}`)
					.send({ owner })
					.set('Authorization', auth);

				expect(response.statusCode).toBe(200);
				pathPartIds.set(marker!, response.body.data.id);
			}
		});

		and('the method ranges:', async (table: Record<string, string>[]) => {
			for (const { marker, method } of table) {
				const response = await request(getUrl(vendor, env))
					.post(`/items/${PATH_RANGE}`)
					.send({ method })
					.set('Authorization', auth);

				expect(response.statusCode).toBe(200);
				pathRangeIds.set(marker!, response.body.data.id);
			}
		});

		and('the slots:', async (table: Record<string, string>[]) => {
			await createPathSlots(
				parseGherkinTable<PathSlotRow & { marker: string }>(table).map(
					({ marker, ...data }) => ({ marker, data }),
				),
				ids,
			);
		});

		defineCachedReadSteps(and, ids, filedMembers, PATH_SLOT);
	}

	// A write to a parent purges through the parent's own index, which is where
	// its `purged fingerprints` are read from like any other.
	function definePathWhenSteps(
		{ when }: StepFunctions,
		ids: Map<string, number>,
	) {
		when.optional(
			'the slots are created:',
			async (table: Record<string, string>[]) => {
				const filedBefore = await indexedMembers();

				await createPathSlots(
					cellRows(table[0]!['query']!) as WrittenPathSlot[],
					ids,
				);

				await expectPurgedFingerprints(
					filedBefore,
					cellRows(table[0]!['purged fingerprints']!),
				);
			},
		);

		when.optional(
			'the method ranges are updated:',
			async (table: Record<string, string>[]) => {
				const filedBefore = await indexedMembers();

				await updatePathRanges(
					cellRows(table[0]!['query']!) as WrittenPathRange[],
				);

				await expectPurgedFingerprints(
					filedBefore,
					cellRows(table[0]!['purged fingerprints']!),
				);
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
		collection: string = SLOT,
	) {
		then.optional(
			/^the read is purged, .+:$/,
			async (table: Record<string, string>[]) => {
				const { query, response, fingerprints } = table[0]!;
				const readQuery = queryParameters(query!);

				await expectCacheStatus(readQuery, 'MISS', collection);
				await expectAnswer(readQuery, ids, cellRows(response!), collection);

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

				await expectCacheStatus(readQuery, 'HIT', collection);
				await expectAnswer(readQuery, ids, cellRows(response!), collection);

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

					await expectCacheStatus(witnessQuery, 'MISS', collection);

					await expectAnswer(
						witnessQuery,
						ids,
						cellRows(response!),
						collection,
					);

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

					await expectCacheStatus(witnessQuery, 'HIT', collection);

					await expectAnswer(
						witnessQuery,
						ids,
						cellRows(response!),
						collection,
					);

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
			'a pinned value carrying a separator purges only its own read',
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
			'a row moving out of the range a read was filtered on purges it',
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
			'a read matching two ways is purged by a write matching only its first',
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

		scenario(
			'a write by another owner leaves a read pinned through a relation cached',
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
			'a write by another owner leaves a composed-path read cached',
			(steps) => {
				const ids = new Map<string, number>();
				const filedMembers = new Map<string, string[]>();

				definePathGivenSteps(steps, ids, filedMembers);

				definePathWhenSteps(steps, ids);

				defineThenSteps(steps, ids, filedMembers, PATH_SLOT);
			},
			60_000,
		);

		scenario(
			'a write by another owner leaves a read selecting through composed paths'
				+ ' cached',
			(steps) => {
				const ids = new Map<string, number>();
				const filedMembers = new Map<string, string[]>();

				definePathGivenSteps(steps, ids, filedMembers);

				definePathWhenSteps(steps, ids);

				defineThenSteps(steps, ids, filedMembers, PATH_SLOT);
			},
			60_000,
		);

		scenario(
			'a write to a parent purges the reads its old and new value match',
			(steps) => {
				const ids = new Map<string, number>();
				const filedMembers = new Map<string, string[]>();

				definePathGivenSteps(steps, ids, filedMembers);

				definePathWhenSteps(steps, ids);

				defineThenSteps(steps, ids, filedMembers, PATH_SLOT);
			},
			60_000,
		);

		scenario(
			'a write to a parent purges the reads selecting through it'
				+ ' that its old and new value match',
			(steps) => {
				const ids = new Map<string, number>();
				const filedMembers = new Map<string, string[]>();

				definePathGivenSteps(steps, ids, filedMembers);

				definePathWhenSteps(steps, ids);

				defineThenSteps(steps, ids, filedMembers, PATH_SLOT);
			},
			60_000,
		);
	});
});
