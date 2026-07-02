import { oneLine } from '@directus/utils';
import { SchemaBuilder } from '@directus/schema-builder';
import knex, { type Knex } from 'knex';
import { MockClient, createTracker, type Tracker } from 'knex-mock-client';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type MockedFunction,
} from 'vitest';

// Force auto-purge on and route shouldClearCache() to a real (truthy) cache.
const env: Record<string, any> = {
	CACHE_AUTO_PURGE: true,
	CACHE_AUTO_PURGE_IGNORE_LIST: [],
	CACHE_NAMESPACE: 'system-cache',
	MAX_BATCH_MUTATION: 100000,
};

vi.mock('@directus/env', () => ({ useEnv: () => env }));

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

// Spy purgeScopedCache and force scoped mode; the cache itself just needs to be truthy
// for shouldClearCache.
const purgeScopedCache = vi.fn();

vi.mock('../cache.js', () => {
	return {
		getCache: () => ({ cache: { clear: vi.fn(), delete: vi.fn() } }),
	};
});

vi.mock('../scoped-cache.js', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('../scoped-cache.js')>()),
		purgeScopedCache,
		scopedCachePurgeEnabled: () => true,
	};
});

const { ItemsService } = await import('./items.js');
const { readMeta } = await import('../utils/read-meta.js');
const { default: emitter } = await import('../emitter.js');

const schema = new SchemaBuilder()
	.collection('test', (c) => {
		c.field('id').id();
		c.field('name').string();
		c.field('student').string();
	})
	.build();

// SchemaBuilder doesn't model the cache meta; attach the scope field directly.
schema.collections['test']!.scopedCacheFields = ['student'];

// Same scoped collection, but with a self-referential relation (`parent` → test). A read
// that pulls `parent.*` reaches the root collection again through an unbounded path.
const selfRefSchema = new SchemaBuilder()
	.collection('test', (c) => {
		c.field('id').id();
		c.field('name').string();
		c.field('student').string();
		c.field('parent').m2o('test');
	})
	.build();

selfRefSchema.collections['test']!.scopedCacheFields = ['student'];

// Drives the purge-tag resolution at every mutation site: which ScopedCacheTags
// (or null = coarse collection-wide purge) each mutation hands to purgeScopedCache —
// asserted via toHaveBeenCalledWith(cache, collection, tags, context). The tag-derivation
// itself is unit-tested in scoped-cache-tags.test.ts; this pins the purge side
// (capture-before-write, old ∪ new for update/delete/upsert).
describe(oneLine`
	scoped cache purge (ItemsService mutation → purgeScopedCache scoped cache tags)
`, () => {
	let db: MockedFunction<Knex>;
	let tracker: Tracker;

	beforeAll(() => {
		db = vi.mocked(knex.default({ client: MockClient }));
		tracker = createTracker(db);
	});

	beforeEach(() => {
		tracker.on.any('test').response({});
	});

	afterEach(() => {
		tracker.reset();
		purgeScopedCache.mockClear();
	});

	const service = () => new ItemsService('test', { knex: db, schema });

	it(oneLine`
		updateMany purges old ∪ new — a row moved student A→B drops both slices
	`, async () => {
		// captureScopedCacheTags selects the pre-update rows (old = A);
		// the payload sets new = B.
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.update('test').response(1);

		await service().updateMany([1], { student: 'B' });

		expect(purgeScopedCache).toHaveBeenCalledTimes(1);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[
				{ collection: 'test', field: 'student', value: 'A' },
				{ collection: 'test', field: 'student', value: 'B' },
			],
			expect.anything(),
		);
	});

	it(oneLine`
		updateMany that leaves the scope field untouched purges only the captured old slice
	`, async () => {
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.update('test').response(1);

		await service().updateMany([1], { name: 'renamed' });

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[{ collection: 'test', field: 'student', value: 'A' }],
			expect.anything(),
		);
	});

	it(oneLine`
		updateMany falls back to a coarse purge (null) when a pre-update row is missing
		the scope field
	`, async () => {
		// snapshotScopedCacheTags needs every row to resolve all scope fields; a row missing
		// `student` makes the old value unknowable → null → coarse collection-wide purge.
		tracker.on.select('test').response([{ id: 1 }]);
		tracker.on.update('test').response(1);

		await service().updateMany([1], { student: 'B' });

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			null,
			expect.anything(),
		);
	});

	it(oneLine`
		deleteMany purges the scope slices of the rows it deleted (captured before delete)
	`, async () => {
		tracker.on.select('test').response([
			{ id: 1, student: 'A' },
			{ id: 2, student: 'B' },
		]);

		tracker.on.delete('test').response(2);

		await service().deleteMany([1, 2]);

		expect(purgeScopedCache).toHaveBeenCalledTimes(1);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[
				{ collection: 'test', field: 'student', value: 'A' },
				{ collection: 'test', field: 'student', value: 'B' },
			],
			expect.anything(),
		);
	});

	it(oneLine`
		upsertMany (insert) purges the new slice — the committed row's scope value
	`, async () => {
		// No key in the payload → pure insert; the new slice comes from the committed row.
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.insert('test').response([1]);

		await service().upsertMany([{ name: 'a', student: 'A' }]);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			expect.arrayContaining([{ collection: 'test', field: 'student', value: 'A' }]),
			expect.anything(),
		);
	});

	it(oneLine`
		upsertMany (update) captures the pre-update slice — a keyed payload snapshots old
		before the write (old ∪ new)
	`, async () => {
		// The payload carries the key → upsertOne takes the update path; the pre-snapshot
		// reads the old slice (A) before the update runs.
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.update('test').response(1);

		await service().upsertMany([{ id: 1, name: 'a', student: 'B' }]);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			expect.arrayContaining([{ collection: 'test', field: 'student', value: 'A' }]),
			expect.anything(),
		);

		// Never the coarse null fallback now that old + new are both snapshotted.
		expect(purgeScopedCache).not.toHaveBeenCalledWith(
			expect.anything(),
			'test',
			null,
			expect.anything(),
		);
	});

	it(oneLine`
		updateBatch purges old ∪ new — re-snapshots the committed rows for the new values
	`, async () => {
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.update('test').response(1);

		await service().updateBatch([{ id: 1, name: 'renamed' }]);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			expect.arrayContaining([{ collection: 'test', field: 'student', value: 'A' }]),
			expect.anything(),
		);
	});

	it(oneLine`
		updateBatch falls back to a coarse purge (null) when a batched row is missing the
		scope field
	`, async () => {
		tracker.on.select('test').response([{ id: 1 }]);
		tracker.on.update('test').response(1);

		await service().updateBatch([{ id: 1, name: 'renamed' }]);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			null,
			expect.anything(),
		);
	});

	// Purge tags come from the value actually stored, not the raw input: a
	// create/update filter hook can rewrite a scope field, and a create hook can
	// take over a row entirely (scope value unknowable).
	it(oneLine`
		create scopes off the committed row — a hook rewrites the scope field before insert,
		so the re-read row (B) wins over the raw input (A)
	`, async () => {
		tracker.on.insert('test').response([1]);
		// The hook stores B, so the post-commit re-snapshot reads B.
		tracker.on.select('test').response([{ id: 1, student: 'B' }]);

		const rewrite = async (payload: any) => ({ ...payload, student: 'B' });
		emitter.onFilter('test.items.create', rewrite);

		try {
			await service().createOne({ name: 'x', student: 'A' });

			expect(purgeScopedCache).toHaveBeenCalledWith(
				expect.anything(),
				'test',
				[{ collection: 'test', field: 'student', value: 'B' }],
				expect.anything(),
			);
		}
		finally {
			emitter.offFilter('test.items.create', rewrite);
		}
	});

	it(oneLine`
		create resolves the DB-stored scope value when the payload omits the field — precise
		slice, not a coarse purge
	`, async () => {
		// Payload has no `student`; the committed row carries the DB default, which the
		// re-snapshot reads back — where the old payload-based path returned null.
		tracker.on.insert('test').response([1]);
		tracker.on.select('test').response([{ id: 1, student: 'default-owner' }]);

		await service().createMany([{ name: 'x' }]);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[{ collection: 'test', field: 'student', value: 'default-owner' }],
			expect.anything(),
		);
	});

	it(oneLine`
		create falls back to a coarse purge (null) when a hook takes over a row (returns a
		PK, scope value unknowable)
	`, async () => {
		const takeOver = async () => 99;
		emitter.onFilter('test.items.create', takeOver);

		try {
			await service().createMany([{ name: 'x', student: 'A' }]);

			expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			null,
			expect.anything(),
		);
		}
		finally {
			emitter.offFilter('test.items.create', takeOver);
		}
	});

	it(oneLine`
		updateMany takes the new value from the post-hook payload, not the raw input
	`, async () => {
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.update('test').response(1);

		// Raw payload sets B, but a hook rewrites it to C — the new slice must be C,
		// unioned with old A.
		const rewrite = async (payload: any) => ({ ...payload, student: 'C' });
		emitter.onFilter('test.items.update', rewrite);

		try {
			await service().updateMany([1], { student: 'B' });

			expect(purgeScopedCache).toHaveBeenCalledWith(
				expect.anything(),
				'test',
				[
					{ collection: 'test', field: 'student', value: 'A' },
					{ collection: 'test', field: 'student', value: 'C' },
				],
				expect.anything(),
			);
		}
		finally {
			emitter.offFilter('test.items.update', rewrite);
		}
	});

	// Regression: the `cache.scope` filter returns its payload unchanged when no
	// extension listens, i.e. the SAME array reference. The read must still carry
	// the bare collection tag — a clear-and-refill of that reference would wipe it,
	// leaving every read untagged and unpurgeable (stale HIT after a write).
	it(oneLine`
		an unfiltered read carries the bare collection tag through the cache.scope filter
	`, async () => {
		tracker.on.select('test').response([{ id: 1, name: 'a', student: 'A' }]);

		const result = await service().readByQuery({});

		expect(readMeta(result)?.scopedCacheTags).toEqual([{ collection: 'test' }]);
	});

	// A filter that bounds the read to one scope value pins the value slice instead of the
	// bare collection tag, so only that owner's/partition's writes purge it.
	it(oneLine`
		a read filtered to a scope value carries the value-slice tag, not the bare collection
	`, async () => {
		tracker.on.select('test').response([{ id: 1, name: 'a', student: 'A' }]);

		const result = await service().readByQuery({ filter: { student: { _eq: 'A' } } });

		expect(readMeta(result)?.scopedCacheTags).toEqual([
			{ collection: 'test', field: 'student', value: 'A' },
		]);
	});

	// A self-referential relation pulls rows of the root collection the root filter can't
	// bound (a parent belongs to any student), so pinning the root to a value slice would
	// leave the read stale after a write to another slice. The root falls back to bare.
	it(oneLine`
		a self-referential read does not pin the root — the nested same-collection rows are
		unbounded, so it tags the bare collection
	`, async () => {
		tracker.on
			.select('test')
			.response([{ id: 1, name: 'a', student: 'A', parent: null }]);

		const selfRefService = new ItemsService('test', { knex: db, schema: selfRefSchema });

		const result = await selfRefService.readByQuery({
			filter: { student: { _eq: 'A' } },
			fields: ['*', 'parent.*'],
		});

		expect(readMeta(result)?.scopedCacheTags).toEqual([{ collection: 'test' }]);
	});

	// A `cache.scope` listener can derive data-level tags: it receives the
	// post-`items.read` records and can append a value slice that the bare AST
	// scoping wouldn't produce (e.g. an enriched related row).
	it(oneLine`
		exposes the enriched records to a cache.scope listener, which can add data-derived
		tags
	`, async () => {
		tracker.on.select('test').response([
			{ id: 1, student: 'A' },
			{ id: 2, student: 'B' },
		]);

		let seenRecords: unknown;

		const listener = async (tags: any, meta: any) => {
			seenRecords = meta.records;
			return [
				...tags,
				...meta.records.map((r: any) => {
					return {
						collection: 'test',
						field: 'student',
						value: r.student,
					};
				}),
			];
		};

		emitter.onFilter('cache.scope', listener);

		try {
			const result = await service().readByQuery({});

			expect(seenRecords).toEqual([
				{ id: 1, student: 'A' },
				{ id: 2, student: 'B' },
			]);

			expect(readMeta(result)?.scopedCacheTags).toEqual([
				{ collection: 'test' },
				{ collection: 'test', field: 'student', value: 'A' },
				{ collection: 'test', field: 'student', value: 'B' },
			]);
		}
		finally {
			emitter.offFilter('cache.scope', listener);
		}
	});
});
