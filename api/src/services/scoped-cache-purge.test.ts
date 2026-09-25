import { oneLine } from '@directus/utils';
import { SchemaBuilder } from '@directus/schema-builder';
import type { MutationOptions } from '@directus/types';
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
} from 'vitest';

// Force auto-purge on and route shouldClearCache() to a real (truthy) cache.
const env: Record<string, any> = {
	CACHE_AUTO_PURGE: true,
	CACHE_AUTO_PURGE_IGNORE_LIST: [],
	CACHE_NAMESPACE: 'scalabus',
	CACHE_SCOPED_MAX_PINS_PER_COLLECTION: 250,
	CACHE_SCOPED_MAX_QUERY_CASES: 16,
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
let scopedPurgeEnabled = true;

vi.mock('../cache.js', () => {
	return {
		getCache: () => ({ cache: { clear: vi.fn(), delete: vi.fn() } }),
	};
});

// The owning modules, not the barrel: the collaborator imports its siblings
// directly, so a stand-in on the re-export would leave the real ones in its graph.
vi.mock('../scoped-cache/purge.js', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('../scoped-cache/purge.js')>()),
		purgeScopedCache,
	};
});

vi.mock('../scoped-cache/config.js', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('../scoped-cache/config.js')>()),
		scopedCachePurgeEnabled: () => scopedPurgeEnabled,
	};
});

const { ItemsService } = await import('./items.js');
const { readMeta } = await import('../utils/read-meta.js');
const { default: emitter } = await import('../emitter.js');

const { createScopedCacheHookDeclarations, scopedCachePinKeys } =
	await import('../scoped-cache/index.js');

// What a read ended up pinned to, as the dev headers and the telemetry spell it:
// `collection`, or `collection:field=value` for a value slice.
const pinnedSlices = (result: unknown): string[] => {
	return scopedCachePinKeys(
		readMeta(result)?.scopedCacheFingerprints ?? [],
	);
};

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

// The same collection declaring NO scope field, where the primary key is the only
// pinning axis there is — the shape every deployment has on every collection.
const unscopedSchema = new SchemaBuilder()
	.collection('test', (c) => {
		c.field('id').id();
		c.field('name').string();
		c.field('student').string();
	})
	.build();

// Cascading into itself: a delete takes rows the caller never named, in slices the
// snapshot cannot see, so the collection needs the collection-wide purge — once.
const selfCascadeSchema = new SchemaBuilder()
	.collection('test', (c) => {
		c.field('id').id();
		c.field('name').string();
		c.field('student').string();
		c.field('parent').m2o('test');
	})
	.build();

selfCascadeSchema.collections['test']!.scopedCacheFields = ['student'];
selfCascadeSchema.relations[0]!.schema = { on_delete: 'CASCADE' } as any;

const cascadeChildSchema = new SchemaBuilder()
	.collection('test', (c) => {
		c.field('id').id();
		c.field('name').string();
		c.field('student').string();
	})
	.collection('test_child', (c) => {
		c.field('id').id();
		c.field('parent').m2o('test');
	})
	.build();

cascadeChildSchema.collections['test']!.scopedCacheFields = ['student'];
cascadeChildSchema.relations[0]!.schema = { on_delete: 'CASCADE' } as any;

// Drives the purge-pin resolution at every mutation site: which ScopedCacheTags
// (or null = coarse collection-wide purge) each mutation hands to purgeScopedCache —
// asserted via toHaveBeenCalledWith(cache, collection, pins, context). The
// pin-derivation
// itself is unit-tested in scoped-cache-pins.test.ts; this pins the purge side
// (snapshot-before-write, old ∪ new for update/delete/upsert).
describe(oneLine`
	scoped cache purge (ItemsService mutation → purgeScopedCache scoped cache tags)
`, () => {
	let db: Knex;
	let tracker: Tracker;

	beforeAll(() => {
		db = knex.default({ client: MockClient });
		tracker = createTracker(db);
	});

	beforeEach(() => {
		tracker.on.any('test').response({});
	});

	afterEach(() => {
		tracker.reset();
		purgeScopedCache.mockClear();
	});

	const service = (withSchema = schema) => {
		return new ItemsService('test', { knex: db, schema: withSchema });
	};

	it(oneLine`
		a delete on a collection that cascades into itself purges it once,
		collection-wide
	`, async () => {
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.delete('test').response(1);

		await service(selfCascadeSchema).deleteMany([1]);

		// Not twice: the slice purge the pins would have driven is a subset of this.
		expect(purgeScopedCache).toHaveBeenCalledTimes(1);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			null,
			expect.anything(),
			expect.objectContaining({ scopedCachePurgeId: expect.any(String) }),
		);
	});

	it(oneLine`
		outside scoped mode a delete flushes the namespace once, not once per
		collection the database changes
	`, async () => {
		scopedPurgeEnabled = false;

		try {
			tracker.on.select('test').response([{ id: 1, student: 'A' }]);
			tracker.on.delete('test').response(1);

			await service(cascadeChildSchema).deleteMany([1]);
		}
		finally {
			scopedPurgeEnabled = true;
		}

		// Each call clears the WHOLE namespace, so the fan-out is pure added latency.
		expect(purgeScopedCache).toHaveBeenCalledTimes(1);
	});

	it(oneLine`
		updateMany purges old ∪ new — a row moved student A→B drops both slices
	`, async () => {
		// snapshotScopedCachePins reads the pre-update row (old = A), then re-reads the
		// committed row after the write (new = B) — the stored row is authoritative, not the
		// payload, so a trigger/coercion rewrite still resolves the right slice. old ∪ new.
		tracker.on.select('test').responseOnce([{ id: 1, student: 'A' }]);
		tracker.on.select('test').responseOnce([{ id: 1, student: 'B' }]);
		tracker.on.update('test').response(1);

		await service().updateMany([1], { student: 'B' });

		expect(purgeScopedCache).toHaveBeenCalledTimes(1);

		// Each snapshot also emits the mutated row's primary-key slice, so it appears
		// once per snapshot (old and new) — the real purge dedups on the pin key.
		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['a'] },
				},
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['b'] },
				},
			],
			expect.anything(),
			expect.anything(),
		);
	});

	it(oneLine`
		updateMany that leaves the scope field untouched still purges the snapshotted
		slice — old and re-read new both resolve to A
	`, async () => {
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.update('test').response(1);

		await service().updateMany([1], { name: 'renamed' });

		// Exact, not arrayContaining: the pins are old ∪ new, so an unchanged value
		// repeats
		// (the real purge dedups via a Set on the pin key). Pinning the whole array also
		// witnesses that no OTHER slice leaks in.
		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['a'] },
				},
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['a'] },
				},
			],
			expect.anything(),
			expect.anything(),
		);
	});

	it(oneLine`
		updateMany with purgeBareFingerprint:false drops the row's own slices and leaves
		the bare tag warm — the reads it names never decided on the written column
	`, async () => {
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.update('test').response(1);

		await service().updateMany(
			[1],
			{ name: 'renamed' },
			{ purgeBareFingerprint: false },
		);

		expect(purgeScopedCache).toHaveBeenCalledTimes(1);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['a'] },
				},
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['a'] },
				},
			],
			expect.anything(),
			// The rows the mutation wrote ride in the same options object; what this
			// case is about is the bare pin the purge is told to leave warm.
			expect.objectContaining({ includeBareFingerprint: false }),
		);
	});

	it(oneLine`
		purgeBareFingerprint:false holds through a delete that cascades into another
		collection — the child takes its coarse purge, the parent keeps its bare tag
	`, async () => {
		purgeScopedCache.mockResolvedValue([]);
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.delete('test').response(1);

		await service(cascadeChildSchema).deleteMany(
			[1],
			{ purgeBareFingerprint: false },
		);

		expect(purgeScopedCache).toHaveBeenCalledTimes(2);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['a'] },
				},
			],
			expect.anything(),
			expect.objectContaining({
				includeBareFingerprint: false,
				scopedCachePurgeId: expect.any(String),
			}),
		);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test_child',
			null,
			expect.anything(),
			{ scopedCachePurgeId: expect.any(String) },
		);
	});

	it(oneLine`
		updateMany falls back to a coarse purge (null) when a pre-update row is missing
		the scope field
	`, async () => {
		// snapshotScopedCachePins needs every row to resolve all scope fields; a row
		// missing `student` makes the old value unknowable → null → coarse
		// collection-wide purge.
		tracker.on.select('test').response([{ id: 1 }]);
		tracker.on.update('test').response(1);

		await service().updateMany([1], { student: 'B' });

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			null,
			expect.anything(),
			// The mutation's own purge id travels with it, so telemetry counts the
			// purge rather than the operations it took to make it.
			{ scopedCachePurgeId: expect.any(String) },
		);
	});

	it(oneLine`
		deleteMany purges the scope slices of the rows it deleted (snapshotted
		before delete)
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
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['a'] },
				},
				{
					collection: 'test',
					pinnedScope: { 'id': ['2'], 'student': ['b'] },
				},
			],
			expect.anything(),
			expect.anything(),
		);
	});

	it(oneLine`
		a delete on a collection whose self-relation sets null purges the survivors
		it rewrites, old slice and new
	`, async () => {
		// Row 2 hangs off the deleted row 1 through `parent`; the database rewrites
		// it under the delete, so it is snapshotted like an update: before, and again
		// once committed.
		tracker.on.select('test').responseOnce([{ id: 2 }]);

		tracker.on.select('test').responseOnce([
			{ id: 1, student: 'A' },
			{ id: 2, student: 'B' },
		]);

		tracker.on.delete('test').response(1);
		tracker.on.select('test').responseOnce([{ id: 2, student: 'B' }]);

		await service(selfRefSchema).deleteMany([1]);

		expect(tracker.history.select[0]?.sql).toMatch(
			/where \("parent" in \(\?\)\) and "id" not in \(\?\)/,
		);

		expect(tracker.history.select[0]?.bindings).toEqual([1, 1]);
		expect(purgeScopedCache).toHaveBeenCalledTimes(1);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['a'] },
				},
				{
					collection: 'test',
					pinnedScope: { 'id': ['2'], 'student': ['b'] },
				},
				{
					collection: 'test',
					pinnedScope: { 'id': ['2'], 'student': ['b'] },
				},
			],
			expect.anything(),
			expect.anything(),
		);
	});

	it(oneLine`
		a delete on a collection with no self-relation looks for no survivor
	`, async () => {
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.delete('test').response(1);

		await service().deleteMany([1]);

		expect(tracker.history.select).toHaveLength(1);
		expect(purgeScopedCache).toHaveBeenCalledTimes(1);
	});

	it(oneLine`
		upsertMany (insert) purges the new slice — the committed row's scope value
	`, async () => {
		// No key in the payload → pure insert; the new slice comes from the committed row.
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.insert('test').response([1]);

		await service().upsertMany([{ name: 'a', student: 'A' }]);

		// Pure insert → empty old snapshot, so the new slice is the whole pin set
		// (exact).
		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['a'] },
				},
			],
			expect.anything(),
			expect.anything(),
		);
	});

	it(oneLine`
		upsertMany (update) snapshots the pre-update slice — a keyed payload takes old
		before the write (old ∪ new)
	`, async () => {
		// The payload carries the key → upsertOne takes the update path; the pre-snapshot
		// reads the old slice (A) before the update runs. arrayContaining (not exact): upsert
		// issues a non-fixed number of selects, so the old ∪ new pin count isn't
		// pinnable — the
		// A→B exact-union witness lives in the updateMany test above.
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.update('test').response(1);

		await service().upsertMany([{ id: 1, name: 'a', student: 'B' }]);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['a'] },
				},
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['a'] },
				},
			],
			expect.anything(),
			expect.anything(),
		);

		// Never the coarse null fallback now that old + new are both snapshotted.
		expect(purgeScopedCache).not.toHaveBeenCalledWith(
			expect.anything(),
			'test',
			null,
			expect.anything(),
			expect.anything(),
		);
	});

	it(oneLine`
		updateBatch purges old ∪ new — re-snapshots the committed rows for the new values
	`, async () => {
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.update('test').response(1);

		await service().updateBatch([{ id: 1, name: 'renamed' }]);

		// Name-only change → scope stays A, so old ∪ new repeats it (exact; real purge dedups).
		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['a'] },
				},
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['a'] },
				},
			],
			expect.anything(),
			expect.anything(),
		);
	});

	it(oneLine`
		updateBatch keeps its own autoPurgeCache:false when the caller passes true, so
		the batch purges once after the commit, not once per forked child
	`, async () => {
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.update('test').response(1);

		// The caller's opts are spread FIRST so this `true` cannot reach the children:
		// a child purge runs inside the transaction, dropping the slices before the
		// rows it read are committed — the window a concurrent read refills as stale.
		await service().updateBatch(
			[{ id: 1, name: 'renamed' }, { id: 2, name: 'other' }],
			// `autoPurgeCache` is typed `false | undefined` — only turning it OFF
			// means anything. Passing the forbidden `true` is the point: even then
			// it must not reach the children.
			{ autoPurgeCache: true } as unknown as MutationOptions,
		);

		expect(purgeScopedCache).toHaveBeenCalledTimes(1);

		// The one call is the deferred parent's: old ∪ new over BOTH batched rows.
		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['a'] },
				},
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['a'] },
				},
			],
			expect.anything(),
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
			// The mutation's own purge id travels with it, so telemetry counts the
			// purge rather than the operations it took to make it.
			{ scopedCachePurgeId: expect.any(String) },
		);
	});

	// Purge pins come from the value actually stored, not the raw input: a
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
				[
					{
						collection: 'test',
						pinnedScope: { 'id': ['1'], 'student': ['b'] },
					},
				],
				expect.anything(),
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
			[
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['default-owner'] },
				},
			],
			expect.anything(),
			expect.anything(),
		);
	});

	it(oneLine`
		create with a NULL scope value purges that null slice — a present-but-null value is a
		real slice (canonical \x00null tag), not the coarse fallback
	`, async () => {
		// The committed row resolves `student` to NULL (unset column, DB default null). The field
		// key IS present, so it's a precise null-slice purge — distinct from a MISSING field key,
		// which is the coarse (null-pins) fallback above. A read filtered
		// `student: { _eq: null }`
		// pins the same slice, so the two sides meet.
		tracker.on.insert('test').response([1]);
		tracker.on.select('test').response([{ id: 1, student: null }]);

		await service().createMany([{ name: 'x' }]);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[
				{
					collection: 'test',
					pinnedScope: { 'id': ['1'], 'student': ['\x00null'] },
				},
			],
			expect.anything(),
			expect.anything(),
		);
	});

	it(oneLine`
		an UNDECLARED take-over falls back to a coarse purge (null) — a take-over can be
		an update-in-disguise whose OLD slice the create path can't recover
	`, async () => {
		// The hook returns a PK but declares nothing. It might have moved that row
		// between slices (an upsert), and createMany has no old∪new snapshot → the old
		// slice would leak. So without a declaration the purge is coarse (null).
		const takeOver = async () => 99;
		emitter.onFilter('test.items.create', takeOver);

		try {
			await service().createMany([{ name: 'x', student: 'A' }]);

			expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			null,
			expect.anything(),
			{ scopedCachePurgeId: expect.any(String) },
		);
		}
		finally {
			emitter.offFilter('test.items.create', takeOver);
		}
	});

	it(oneLine`
		a take-over the hook declares wrote nothing purges nothing at all
	`, async () => {
		// Nothing was written, so no entry can have gone stale — and an empty pin
		// array is not "nothing": it still resolves to this collection's bare pin.
		const takeOver = async (_payload: any, _meta: any, ctx: any) => {
			ctx.scopedCache.skipPurgeFor(99);
			return 99;
		};

		emitter.onFilter('test.items.create', takeOver);

		try {
			await service().createMany([{ name: 'x', student: 'A' }]);

			expect(purgeScopedCache).not.toHaveBeenCalled();
		}
		finally {
			emitter.offFilter('test.items.create', takeOver);
		}
	});

	it(oneLine`
		a skipped take-over beside a real create still purges the created row's slice
	`, async () => {
		tracker.on.insert('test').response([1]);
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);

		const takeOverDuplicate = async (payload: any, _meta: any, ctx: any) => {
			if (payload.name !== `dup`) {
				return payload;
			}

			ctx.scopedCache.skipPurgeFor(99);
			return 99;
		};

		emitter.onFilter('test.items.create', takeOverDuplicate);

		try {
			await service().createMany([
				{ name: 'x', student: 'A' },
				{ name: 'dup', student: 'A' },
			]);

			// Precise, not coarse: discounting the skipped row leaves the live keys
			// matching the create actions, so the take-over check no longer trips.
			// The skipped key is absent from the key axis too — it wrote nothing.
			expect(purgeScopedCache).toHaveBeenCalledWith(
				expect.anything(),
				'test',
				[
					{
						collection: 'test',
						pinnedScope: { 'id': ['1'], 'student': ['a'] },
					},
				],
				expect.anything(),
				expect.anything(),
			);
		}
		finally {
			emitter.offFilter('test.items.create', takeOverDuplicate);
		}
	});

	it(oneLine`
		updateMany's new slice reflects a hook-rewritten scope value — it re-reads the
		committed row, and the hook's payload is what got written
	`, async () => {
		// Old = A (pre-update). Raw payload sets B, but a hook rewrites it to C, so C is what
		// the update writes; the post-commit re-read returns C → new slice C, unioned with A.
		tracker.on.select('test').responseOnce([{ id: 1, student: 'A' }]);
		tracker.on.select('test').responseOnce([{ id: 1, student: 'C' }]);
		tracker.on.update('test').response(1);

		const rewrite = async (payload: any) => ({ ...payload, student: 'C' });
		emitter.onFilter('test.items.update', rewrite);

		try {
			await service().updateMany([1], { student: 'B' });

			expect(purgeScopedCache).toHaveBeenCalledWith(
				expect.anything(),
				'test',
				[
					{
						collection: 'test',
						pinnedScope: { 'id': ['1'], 'student': ['a'] },
					},
					{
						collection: 'test',
						pinnedScope: { 'id': ['1'], 'student': ['c'] },
					},
				],
				expect.anything(),
				expect.anything(),
			);
		}
		finally {
			emitter.offFilter('test.items.update', rewrite);
		}
	});

	// Regression: the `cache.scope` filter returns its payload unchanged when no
	// extension listens, i.e. the SAME array reference. The read must still carry
	// the bare collection slice — a clear-and-refill of that reference would wipe
	// it, leaving every read unpinned and unpurgeable (stale HIT after a write).
	it(oneLine`
		an unfiltered read carries the bare collection slice through the cache.scope
		filter
	`, async () => {
		tracker.on.select('test').response([{ id: 1, name: 'a', student: 'A' }]);

		const result = await service().readByQuery({});

		expect(pinnedSlices(result)).toEqual(['test']);
	});

	// A filter that bounds the read to one scope value pins the value slice instead of the
	// bare collection, so only that owner's/partition's writes purge it.
	it(oneLine`
		a read filtered to a scope value carries the value slice, not the bare collection
	`, async () => {
		tracker.on.select('test').response([{ id: 1, name: 'a', student: 'A' }]);

		const result = await service().readByQuery({ filter: { student: { _eq: 'A' } } });

		expect(pinnedSlices(result)).toEqual(['test:student=a']);
	});

	// The ancestor slice's LAST hop lands on a collection the filter names by primary
	// key, which is classified `independent`: it needs no pin of its own, yet it holds
	// the key the descendant slices by. Reading only the keyed pins loses that key, so
	// every ownership chain ending on such a terminal fell back to the bare pin — one
	// write anywhere in `holder` then dropping every owner's entry.
	it(oneLine`
		an ancestor slice whose terminal is independent pins the slice, not the bare tag
	`, async () => {
		tracker.on.select('note').response([{ id: 1, holder: 5 }]);
		tracker.on.select('holder').response([{ id: 5, owner: 9 }]);

		const noteService = new ItemsService('note', {
			knex: db,
			schema: independentTerminalSchema,
		});

		const result = await noteService.readByQuery({
			fields: ['*', 'holder.owner'],
			filter: { holder: { owner: { id: { _eq: 9 } } } },
		});

		expect(
			pinnedSlices(result).filter((slice) => slice.startsWith('holder')),
		).toEqual(['holder:id=5', 'holder:owner=9']);
	});

	// A self-referential relation pulls rows of the root collection the root filter can't
	// bound (a parent belongs to any student), so pinning the root to a value slice would
	// leave the read stale after a write to another slice. The root falls back to bare.
	it(oneLine`
		a self-referential read does not pin the root — the nested same-collection rows are
		unbounded, so it carries the bare collection
	`, async () => {
		tracker.on
			.select('test')
			.response([{ id: 1, name: 'a', student: 'A', parent: null }]);

		const selfRefService = new ItemsService('test', { knex: db, schema: selfRefSchema });

		const result = await selfRefService.readByQuery({
			filter: { student: { _eq: 'A' } },
			fields: ['*', 'parent.*'],
		});

		expect(pinnedSlices(result)).toEqual(['test']);
	});

	// A `cache.scope` listener can derive data-level pins: it receives the
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

			// The `cache.scope` listener adds these pins itself (no schema type on hand),
			// so they stay untyped — an extension owns both sides of its own pins.
			expect(pinnedSlices(result)).toEqual([
				'test',
				'test:student=A',
				'test:student=B',
			]);
		}
		finally {
			emitter.offFilter('cache.scope', listener);
		}
	});

	// `context.scopedCache` carries only the event's method: an `items.read` filter
	// scopes the response via `scopeTo`; a create/update/delete filter purges via
	// `purgeBy`. Additive to what the framework derived — read pins into the meta
	// rider, declared fingerprints beside the mutation's own purge.
	describe('context.scopedCache scopeTo / purgeBy hooks', () => {
		it(oneLine`
			an items.read hook scopes the response to a cross-collection tag, unioned with
			the auto-derived collection tag on the meta rider
		`, async () => {
			tracker.on.select('test').response([{ id: 1, name: 'a', student: 'A' }]);

			const declare = async (payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.scopeTo({
					collection: 'authors',
					pinnedScope: { id: [5] },
				});

				return payload;
			};

			emitter.onFilter('test.items.read', declare);

			try {
				const result = await service().readByQuery({});

				expect(pinnedSlices(result)).toEqual(['test', 'authors:id=5']);
			}
			finally {
				emitter.offFilter('test.items.read', declare);
			}
		});

		it(oneLine`
			flags a read whose hook scopeTo's a field the collection isn't scoped on as
			unautopurgeable — no write can auto-purge that slice
		`, async () => {
			tracker.on.select('test').response([{ id: 1, name: 'a', student: 'A' }]);

			// A FOREIGN collection, so nothing else on this response covers it: `other`
			// is scoped on no `ghost` field, and no other pin names `other` either, so
			// no write reaches this entry through it. On the read's OWN collection the
			// same pin would be harmless freight beside its computed slice.
			const declare = async (payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.scopeTo({
					collection: 'other',
					pinnedScope: { ghost: ['g'] },
				});

				return payload;
			};

			emitter.onFilter('test.items.read', declare);

			try {
				const result = await service().readByQuery({});

				expect(readMeta(result)?.scopedCacheUnautopurgeableFingerprints).toEqual([
					{ collection: 'other', pinnedScope: { ghost: ['g'] } },
				]);
			}
			finally {
				emitter.offFilter('test.items.read', declare);
			}
		});

		it(oneLine`
			does NOT flag the same tag when the hook declares manuallyPurged — the author
			reproduces it via their own purgeBy
		`, async () => {
			tracker.on.select('test').response([{ id: 1, name: 'a', student: 'A' }]);

			const declare = async (payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.scopeTo(
					{ collection: 'other', pinnedScope: { ghost: ['g'] } },
					{ manuallyPurged: true },
				);

				return payload;
			};

			emitter.onFilter('test.items.read', declare);

			try {
				const result = await service().readByQuery({});
				expect(readMeta(result)?.scopedCacheUnautopurgeableFingerprints).toEqual([]);
			}
			finally {
				emitter.offFilter('test.items.read', declare);
			}
		});

		it(oneLine`
			does NOT flag a scopeTo on a scoped field — that slice is reproduced by the
			collection's own auto-purge
		`, async () => {
			tracker.on.select('test').response([{ id: 1, name: 'a', student: 'A' }]);

			const declare = async (payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.scopeTo({
					collection: 'test',
					pinnedScope: { student: ['A'] },
				});

				return payload;
			};

			emitter.onFilter('test.items.read', declare);

			try {
				const result = await service().readByQuery({});
				expect(readMeta(result)?.scopedCacheUnautopurgeableFingerprints).toEqual([]);
			}
			finally {
				emitter.offFilter('test.items.read', declare);
			}
		});

		it(oneLine`
			does NOT flag a scopeTo on a collection's PRIMARY KEY, though it is not among
			its scoped fields — every collection auto-purges its key slice
		`, async () => {
			tracker.on.select('test').response([{ id: 1, name: 'a', student: 'A' }]);

			// `test` is scoped on `student` only, so `id` reads as an undeclared field
			// and used to be flagged — the key axis is what makes it reproducible.
			const declare = async (payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.scopeTo({ collection: 'test', pinnedScope: { id: [1] } });
				return payload;
			};

			emitter.onFilter('test.items.read', declare);

			try {
				const result = await service().readByQuery({});
				expect(readMeta(result)?.scopedCacheUnautopurgeableFingerprints).toEqual([]);
			}
			finally {
				emitter.offFilter('test.items.read', declare);
			}
		});

		it(oneLine`
			does NOT flag a scopeTo on a COMPOSED path of a foreign collection — a write
			there derives the same path off its flat scope field
		`, async () => {
			tracker.on.select('student_enrollment').response([{ id: 1, student: 'A' }]);

			const declare = async (payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.scopeTo({
					collection: 'student_course',
					pinnedScope: { 'teaching_unit.discipline.enrollment.student': ['A'] },
				});

				return payload;
			};

			emitter.onFilter('student_enrollment.items.read', declare);

			try {
				const result = await new ItemsService('student_enrollment', {
					knex: db,
					schema: composedChainSchema,
				}).readByQuery({});

				expect(readMeta(result)?.scopedCacheUnautopurgeableFingerprints).toEqual([]);
			}
			finally {
				emitter.offFilter('student_enrollment.items.read', declare);
			}
		});

		it(oneLine`
			flags a dotted scopeTo no write composes — the path leaves the scope chain
		`, async () => {
			tracker.on.select('student_enrollment').response([{ id: 1, student: 'A' }]);

			const declare = async (payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.scopeTo({
					collection: 'student_course',
					pinnedScope: { 'teaching_unit.id': [10] },
				});

				return payload;
			};

			emitter.onFilter('student_enrollment.items.read', declare);

			try {
				const result = await new ItemsService('student_enrollment', {
					knex: db,
					schema: composedChainSchema,
				}).readByQuery({});

				expect(readMeta(result)?.scopedCacheUnautopurgeableFingerprints).toEqual([
					{
						collection: 'student_course',
						pinnedScope: { 'teaching_unit.id': ['10'] },
					},
				]);
			}
			finally {
				emitter.offFilter('student_enrollment.items.read', declare);
			}
		});

		it(oneLine`
			carries every collection a dotted scopeTo crosses, under the slice each one
			emits, typed off the terminal column
		`, async () => {
			tracker.on.select('student_enrollment').response([{ id: 1, student: 'A' }]);

			const declare = async (payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.scopeTo({
					collection: 'student_course',
					pinnedScope: { 'teaching_unit.discipline.enrollment.student': ['A'] },
				});

				return payload;
			};

			emitter.onFilter('student_enrollment.items.read', declare);

			try {
				const result = await new ItemsService('student_enrollment', {
					knex: db,
					schema: composedChainSchema,
				}).readByQuery({});

				expect(pinnedSlices(result)).toEqual([
					'student_enrollment',
					'student_course:teaching_unit.discipline.enrollment.student=a',
					'student_teaching_unit:discipline.enrollment.student=a',
					'student_discipline:enrollment.student=a',
					'student_enrollment:student=a',
				]);
			}
			finally {
				emitter.offFilter('student_enrollment.items.read', declare);
			}
		});

		it(oneLine`
			carries a crossed collection bare when it emits no slice for the suffix
		`, async () => {
			tracker.on.select('page').response([{ id: 1 }]);

			const declare = async (payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.scopeTo({
					collection: 'course',
					pinnedScope: { 'unit.owner': [7] },
				});

				return payload;
			};

			emitter.onFilter('page.items.read', declare);

			try {
				const result = await new ItemsService('page', {
					knex: db,
					schema: declaredDottedSchema,
				}).readByQuery({});

				expect(pinnedSlices(result)).toEqual([
					'page',
					'course:unit.owner=7',
					'unit',
				]);
			}
			finally {
				emitter.offFilter('page.items.read', declare);
			}
		});

		it(oneLine`
			does NOT flag a bare collection tag — it names no slice, so any write to the
			collection reproduces it
		`, async () => {
			tracker.on.select('test').response([{ id: 1, name: 'a', student: 'A' }]);

			const declare = async (payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.scopeTo({ collection: 'test' });
				return payload;
			};

			emitter.onFilter('test.items.read', declare);

			try {
				const result = await service().readByQuery({});
				expect(readMeta(result)?.scopedCacheUnautopurgeableFingerprints).toEqual([]);
			}
			finally {
				emitter.offFilter('test.items.read', declare);
			}
		});

		it(oneLine`
			an items.create hook declares a fingerprint, purged beside the committed-row
			slice rather than inside its tag list
		`, async () => {
			tracker.on.insert('test').response([1]);
			tracker.on.select('test').response([{ id: 1, student: 'A' }]);

			const declare = async (payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.purgeBy({
					collection: 'authors',
					pinnedScope: { id: [5] },
				});

				return payload;
			};

			emitter.onFilter('test.items.create', declare);

			try {
				await service().createMany([{ name: 'x', student: 'A' }]);

				expect(purgeScopedCache).toHaveBeenCalledWith(
					expect.anything(),
					'test',
					[
						{
							collection: 'test',
							pinnedScope: { 'id': ['1'], 'student': ['a'] },
						},
					],
					expect.anything(),
					expect.objectContaining({
						declaredFingerprints: [{
							collection: 'authors',
							pinnedScope: { id: ['5'] },
						}],
					}),
				);
			}
			finally {
				emitter.offFilter('test.items.create', declare);
			}
		});

		it(oneLine`
			an items.update hook declares a fingerprint, purged beside the old ∪ new
			slices rather than inside their tag list
		`, async () => {
			tracker.on.select('test').responseOnce([{ id: 1, student: 'A' }]);
			tracker.on.select('test').responseOnce([{ id: 1, student: 'B' }]);
			tracker.on.update('test').response(1);

			const declare = async (payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.purgeBy({
					collection: 'authors',
					pinnedScope: { id: [5] },
				});

				return payload;
			};

			emitter.onFilter('test.items.update', declare);

			try {
				await service().updateMany([1], { student: 'B' });

				expect(purgeScopedCache).toHaveBeenCalledWith(
					expect.anything(),
					'test',
					[
						{
							collection: 'test',
							pinnedScope: { 'id': ['1'], 'student': ['a'] },
						},
						{
							collection: 'test',
							pinnedScope: { 'id': ['1'], 'student': ['b'] },
						},
					],
					expect.anything(),
					expect.objectContaining({
						declaredFingerprints: [{
							collection: 'authors',
							pinnedScope: { id: ['5'] },
						}],
					}),
				);
			}
			finally {
				emitter.offFilter('test.items.update', declare);
			}
		});

		it(oneLine`
			an items.delete hook declares a fingerprint, purged beside the deleted rows'
			slices rather than inside their tag list
		`, async () => {
			tracker.on.select('test').response([{ id: 1, student: 'A' }]);
			tracker.on.delete('test').response(1);

			const declare = async (keys: any, _meta: any, ctx: any) => {
				ctx.scopedCache.purgeBy({
					collection: 'authors',
					pinnedScope: { id: [5] },
				});

				return keys;
			};

			emitter.onFilter('test.items.delete', declare);

			try {
				await service().deleteMany([1]);

				expect(purgeScopedCache).toHaveBeenCalledWith(
					expect.anything(),
					'test',
					[
						{
							collection: 'test',
							pinnedScope: { 'id': ['1'], 'student': ['a'] },
						},
					],
					expect.anything(),
					expect.objectContaining({
						declaredFingerprints: [{
							collection: 'authors',
							pinnedScope: { id: ['5'] },
						}],
					}),
				);
			}
			finally {
				emitter.offFilter('test.items.delete', declare);
			}
		});

		it(oneLine`
			a take-over that DECLARES its footprint narrows to a precise purge — the
			declaration opts out of the safe coarse fallback
		`, async () => {
			// A take-over is coarse BY DEFAULT (old slice unrecoverable in the create
			// path). A declaration asserts the hook knows its footprint, so we trust it
			// and narrow: the taken-over row's re-read slice (Z) plus the declared
			// fingerprint — never the coarse null flush.
			tracker.on.select('test').response([{ id: 99, student: 'Z' }]);

			const takeOver = async (_payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.purgeBy({
					collection: 'authors',
					pinnedScope: { id: [5] },
				});

				return 99;
			};

			emitter.onFilter('test.items.create', takeOver);

			try {
				await service().createMany([{ name: 'x', student: 'A' }]);

				expect(purgeScopedCache).toHaveBeenCalledWith(
					expect.anything(),
					'test',
					[
						{
							collection: 'test',
							pinnedScope: { 'id': ['99'], 'student': ['z'] },
						},
					],
					expect.anything(),
					expect.objectContaining({
						declaredFingerprints: [{
							collection: 'authors',
							pinnedScope: { id: ['5'] },
						}],
					}),
				);

				expect(purgeScopedCache).not.toHaveBeenCalledWith(
					expect.anything(),
					'test',
					null,
					expect.anything(),
					expect.anything(),
				);
			}
			finally {
				emitter.offFilter('test.items.create', takeOver);
			}
		});

		it(oneLine`
			a hook that declares a slice then cancels (null) purges only that slice —
			includeBareFingerprint:false keeps the cancelled collection's bare tag warm,
			since nothing in it changed
		`, async () => {
			// updateMany snapshots the pre-update rows before the filter runs (old ∪ new),
			// even when the filter goes on to cancel — so a row still has to resolve.
			tracker.on.select('test').response([{ id: 1, student: 'A' }]);

			const declareThenCancel = async (_payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.purgeBy({
					collection: 'authors',
					pinnedScope: { id: [5] },
				});

				return null; // cancel the update
			};

			emitter.onFilter('test.items.update', declareThenCancel);

			try {
				await service().updateMany(
					[1],
					{ student: 'B' },
					{ allowFilterCancel: true },
				);

				// Only the declared fingerprint, and the 5th arg excludes the bare pin.
				expect(purgeScopedCache).toHaveBeenCalledTimes(1);

				expect(purgeScopedCache).toHaveBeenCalledWith(
					expect.anything(),
					'test',
					[],
					expect.anything(),
					{
						includeBareFingerprint: false,
						declaredFingerprints: [{
							collection: 'authors',
							pinnedScope: { id: ['5'] },
						}],
					},
				);
			}
			finally {
				emitter.offFilter('test.items.update', declareThenCancel);
			}
		});

		it(oneLine`
			a delete hook that declares a slice then cancels (null) purges only
			that slice — includeBareFingerprint:false keeps the cancelled
			collection's bare tag warm, since nothing in it was deleted
		`, async () => {
			// deleteMany snapshots rows AFTER the filter, so a cancel returns
			// before any select — only the hook-declared slice is purged.
			const declareThenCancel = async (_keys: any, _meta: any, ctx: any) => {
				ctx.scopedCache.purgeBy({
					collection: 'authors',
					pinnedScope: { id: [5] },
				});

				return null; // cancel the delete
			};

			emitter.onFilter('test.items.delete', declareThenCancel);

			try {
				await service().deleteMany([1], { allowFilterCancel: true });

				// Only the declared fingerprint, and the 5th arg excludes the bare pin.
				expect(purgeScopedCache).toHaveBeenCalledTimes(1);

				expect(purgeScopedCache).toHaveBeenCalledWith(
					expect.anything(),
					'test',
					[],
					expect.anything(),
					{
						includeBareFingerprint: false,
						declaredFingerprints: [{
							collection: 'authors',
							pinnedScope: { id: ['5'] },
						}],
					},
				);
			}
			finally {
				emitter.offFilter('test.items.delete', declareThenCancel);
			}
		});

		it(oneLine`
			a coarse (null) purge carrying a hook declaration reflects BOTH in the debug
			header — the hook purge's result is unioned in, not dropped
		`, async () => {
			// Re-read missing `student` → snapshot null → coarse purge; the hook also
			// declares a foreign slice, so purgeScopedCache runs twice (coarse null +
			// hook pins) and scopedCachePurged must union both.
			tracker.on.select('test').response([{ id: 1 }]);
			tracker.on.update('test').response(1);

			const declare = async (payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.purgeBy({
					collection: 'authors',
					pinnedScope: { id: [5] },
				});

				return payload;
			};

			purgeScopedCache
				.mockResolvedValueOnce([{ collection: 'test' }])
				.mockResolvedValueOnce([
					{ collection: 'authors', pinnedScope: { id: [5] } },
				]);

			emitter.onFilter('test.items.update', declare);

			try {
				const svc = service();
				await svc.updateMany([1], { name: 'x' });

				expect(purgeScopedCache).toHaveBeenNthCalledWith(
					1,
					expect.anything(),
					'test',
					null,
					expect.anything(),
					{ scopedCachePurgeId: expect.any(String) },
				);

				// Coarse already flushed this collection's bare pin + every slice, so the
				// hook purge must NOT re-add it: includeBareFingerprint:false (else the bare
				// pin is purged twice and doubled in the debug header).
				expect(purgeScopedCache).toHaveBeenNthCalledWith(
					2,
					expect.anything(),
					'test',
					[],
					expect.anything(),
					{
						includeBareFingerprint: false,
						declaredFingerprints: [{
							collection: 'authors',
							pinnedScope: { id: ['5'] },
						}],
						scopedCachePurgeId: expect.any(String),
					},
				);

				// Two operations, ONE purge — they share the id telemetry counts by,
				// for the same reason they share one debug header. Without it an entry
				// both reach reports two purges for the one mutation behind them.
				const [coarseCall, hookCall] = purgeScopedCache.mock.calls;

				expect(hookCall![4].scopedCachePurgeId)
					.toBe(coarseCall![4].scopedCachePurgeId);

				expect(svc.scopedCachePurged).toEqual([
					{ collection: 'test' },
					{ collection: 'authors', pinnedScope: { id: [5] } },
				]);
			}
			finally {
				emitter.offFilter('test.items.update', declare);
			}
		});

		it(oneLine`
			an UNDECLARED take-over stays coarse (null) even when an injected shared
			collector already carries a sibling operation's tags — the fallback keys off
			THIS call's own declarations, not the collector's running total
		`, async () => {
			// A batch/upsert parent injects one shared collector across its children. Seed
			// it as if an earlier child already declared a slice; a later child that takes
			// over a row but declares nothing ITSELF must still fall back to coarse — else
			// the pre-seeded pin reads as this row's declaration and its old slice leaks.
			const shared = createScopedCacheHookDeclarations(schema);
			shared.purge.purgeBy({ collection: 'siblings', pinnedScope: { id: [1] } });

			// Coarse + hook-pins → purgeScopedCache runs twice and unions results; real
			// module returns arrays, so give the spy an iterable (args are the check).
			purgeScopedCache.mockResolvedValue([]);

			tracker.on.select('test').response([{ id: 99, student: 'Z' }]);

			const takeOver = async () => 99; // takes over a row, declares nothing new
			emitter.onFilter('test.items.create', takeOver);

			try {
				await service().createMany(
					[{ name: 'x', student: 'A' }],
					{ scopedCacheHookDeclarations: shared },
				);

				// Coarse (null) despite the pre-seeded collector.
				expect(purgeScopedCache).toHaveBeenNthCalledWith(
					1,
					expect.anything(),
					'test',
					null,
					expect.anything(),
					{ scopedCachePurgeId: expect.any(String) },
				);

				// Never the precise take-over slice (Z) — that would leak the old slice.
				expect(purgeScopedCache).not.toHaveBeenCalledWith(
					expect.anything(),
					'test',
					expect.arrayContaining([
						{ collection: 'test', field: 'student', value: 'Z', type: 'string' },
					]),
					expect.anything(),
					expect.anything(),
				);
			}
			finally {
				emitter.offFilter('test.items.create', takeOver);
			}
		});
	});

	// The primary key pins on every collection with no config, so both sides must
	// agree on a collection that declares nothing at all — what most deployments have.
	describe('implicit primary-key axis', () => {
		const unscopedService = () => {
			return new ItemsService('test', { knex: db, schema: unscopedSchema });
		};

		it(oneLine`
			readOne pins the row it is bounded to instead of the bare collection, on a
			collection declaring no scope field
		`, async () => {
			tracker.on.select('test').response([{ id: 1, name: 'a', student: 'A' }]);

			const result = await unscopedService().readOne(1);

			expect(pinnedSlices(result)).toEqual(['test:id=1']);
		});

		it(oneLine`
			a self-referential readOne does not pin the key — the embedded same-collection
			rows are unbounded, so a write to any of them has to invalidate the read
		`, async () => {
			tracker.on
				.select('test')
				.response([{ id: 1, name: 'a', student: 'A', parent: null }]);

			const selfRefService = new ItemsService('test', {
				knex: db,
				schema: selfRefSchema,
			});

			const result = await selfRefService.readOne(1, { fields: ['*', 'parent.*'] });

			expect(pinnedSlices(result)).toEqual(['test']);
		});

		it(oneLine`
			an update on a collection declaring no scope field purges the mutated row's key
			slice, and pays no SELECT for it
		`, async () => {
			tracker.on.update('test').response(1);

			await unscopedService().updateMany([1], { name: 'renamed' });

			// old ∪ new both resolve from the keys already in hand, so it repeats — the
			// real purge dedups on the pin key.
			expect(purgeScopedCache).toHaveBeenCalledWith(
				expect.anything(),
				'test',
				[
					{
						collection: 'test',
						pinnedScope: { 'id': ['1'] },
					},
					{
						collection: 'test',
						pinnedScope: { 'id': ['1'] },
					},
				],
				expect.anything(),
				expect.anything(),
			);

			// Only the declared-scope snapshot issues a SELECT; the key axis reads the
			// keys it was handed, so this mutation touches the DB for the write alone.
			expect(tracker.history.select).toHaveLength(0);
		});

		it(oneLine`
			an undeclared take-over falls back to a coarse purge on a collection declaring
			no scope field too — the key it returned is not the only row it may have
			written, and every other row's key slice would stay stale
		`, async () => {
			// The hook writes a row it never names (the shape a merge/dedup take-over
			// has) and returns a different key. Only 99 is knowable here, so a precise
			// purge of 99 alone leaves 5's own keyed read serving the pre-write row.
			// Before the key axis, an unscoped collection was entirely bare-tagged and
			// the bare purge covered 5 by accident; now nothing does.
			const takeOver = async () => {
				await db('test')
					.where({ id: 5 })
					.update({ name: 'merged' });

				return 99;
			};

			emitter.onFilter('test.items.create', takeOver);
			tracker.on.update('test').response(1);

			try {
				await unscopedService().createMany([{ name: 'x' }]);

				expect(purgeScopedCache).toHaveBeenCalledWith(
					expect.anything(),
					'test',
					null,
					expect.anything(),
					{ scopedCachePurgeId: expect.any(String) },
				);
			}
			finally {
				emitter.offFilter('test.items.create', takeOver);
			}
		});

		it(oneLine`
			a take-over that DECLARES its footprint keeps the precise purge on a
			collection declaring no scope field — the claim is what buys the precision
		`, async () => {
			const takeOver = async (_payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.purgeBy({
					collection: 'test',
					pinnedScope: { id: [5] },
				});

				return 99;
			};

			emitter.onFilter('test.items.create', takeOver);

			try {
				await unscopedService().createMany([{ name: 'x' }]);

				expect(purgeScopedCache).toHaveBeenCalledWith(
					expect.anything(),
					'test',
					[
						{
							collection: 'test',
							pinnedScope: { 'id': ['99'] },
						},
					],
					expect.anything(),
					expect.objectContaining({
						declaredFingerprints: [{
							collection: 'test',
							pinnedScope: { id: ['5'] },
						}],
					}),
				);
			}
			finally {
				emitter.offFilter('test.items.create', takeOver);
			}
		});
	});
});

// Composition extends each path with one more hop, so `student_course` ends up with
// three of them off the same chain. They resolve in ONE query with the hops shared,
// which is what these pin: the count, the shape, and that the pins did not change.
const composedChainSchema = new SchemaBuilder()
	.collection('student_course', (c) => {
		c.field('id').id();
		c.field('name').string();
		c.field('teaching_unit').m2o('student_teaching_unit');
	})
	.collection('student_teaching_unit', (c) => {
		c.field('id').id();
		c.field('discipline').m2o('student_discipline');
	})
	.collection('student_discipline', (c) => {
		c.field('id').id();
		c.field('enrollment').m2o('student_enrollment');
	})
	.collection('student_enrollment', (c) => {
		c.field('id').id();
		c.field('student').string();
	})
	.build();

const composedChain = composedChainSchema.collections;

composedChain['student_course']!.scopedCacheFields = ['teaching_unit'];
composedChain['student_teaching_unit']!.scopedCacheFields = ['discipline'];
composedChain['student_discipline']!.scopedCacheFields = ['enrollment'];
composedChain['student_enrollment']!.scopedCacheFields = ['student'];

// A dotted path DECLARED on the course, with the unit it crosses declaring no scope
// of its own: a unit write emits its key slice only, so nothing finer than the
// bare unit pin names the rows the path reads there.
const declaredDottedSchema = new SchemaBuilder()
	.collection('page', (c) => {
		c.field('id').id();
	})
	.collection('course', (c) => {
		c.field('id').id();
		c.field('unit').m2o('unit');
	})
	.collection('unit', (c) => {
		c.field('id').id();
		c.field('owner').integer();
	})
	.build();

declaredDottedSchema.collections['course']!.scopedCacheFields = ['unit.owner'];

// A read that EMBEDS its ancestor's rows. `holder` is fetched as rows, so its keyed
// filter pin is not trusted — rows can arrive by a path the filter never keyed — and
// the ancestor slice has to carry it instead. That slice hangs off `owner_account`,
// which the filter names by PRIMARY KEY across the relation: classified
// `independent`, pinned by nothing of its own while still holding the key the
// slice is built from.
const independentTerminalSchema = new SchemaBuilder()
	.collection('note', (c) => {
		c.field('id').id();
		c.field('holder').m2o('holder');
	})
	.collection('holder', (c) => {
		c.field('id').id();
		c.field('owner').m2o('owner_account');
	})
	.collection('owner_account', (c) => {
		c.field('id').id();
		c.field('name').string();
	})
	.build();

const independentTerminal = independentTerminalSchema.collections;

independentTerminal['note']!.scopedCacheFields = ['holder'];
independentTerminal['holder']!.scopedCacheFields = ['owner'];

// `independent` is granted only behind an enforced fk: every way the far row can
// disappear writes the near row too, so the near row's own pin covers it.
for (const relation of independentTerminalSchema.relations) {
	relation.schema = { on_delete: 'CASCADE' } as any;
}

// Two chains landing on a terminal carrying the same NAME on both sides. Keying the
// projected columns by the terminal field would collapse them onto one value.
const sharedTerminalNameSchema = new SchemaBuilder()
	.collection('note', (c) => {
		c.field('id').id();
		c.field('left_ref').m2o('left_holder');
		c.field('right_ref').m2o('right_holder');
	})
	.collection('left_holder', (c) => {
		c.field('id').id();
		c.field('owner').string();
	})
	.collection('right_holder', (c) => {
		c.field('id').id();
		c.field('owner').string();
	})
	.build();

const sharedTerminalName = sharedTerminalNameSchema.collections;

sharedTerminalName['note']!.scopedCacheFields = ['left_ref', 'right_ref'];
sharedTerminalName['left_holder']!.scopedCacheFields = ['owner'];
sharedTerminalName['right_holder']!.scopedCacheFields = ['owner'];

describe('scoped cache path snapshot (one query for every path)', () => {
	let db: Knex;
	let tracker: Tracker;

	beforeAll(() => {
		db = knex.default({ client: MockClient });
		tracker = createTracker(db);
	});

	afterEach(() => {
		tracker.reset();
		purgeScopedCache.mockClear();
	});

	const joinedSelects = () => {
		return tracker.history.select.filter(({ sql }) => sql.includes('left join'));
	};

	it(oneLine`
		resolves three composed paths in a single joined query per snapshot, sharing the
		hops the shorter paths already walked
	`, async () => {
		tracker.on.select('student_course').responseOnce([
			{ id: 1, teaching_unit: 10, '#path0': 20, '#path1': 30, '#path2': 'A' },
		]);

		tracker.on.update('student_course').response(1);

		tracker.on.select('student_course').responseOnce([
			{ id: 1, teaching_unit: 10, '#path0': 20, '#path1': 30, '#path2': 'A' },
		]);

		await new ItemsService(
			'student_course',
			{ knex: db, schema: composedChainSchema },
		).updateMany([1], { name: 'renamed' });

		// One per snapshot, and updateMany snapshots the old row then the committed one.
		expect(joinedSelects()).toHaveLength(2);

		// Three hops for three paths, not the 1 + 2 + 3 a query per path would walk.
		expect(joinedSelects()[0]!.sql.match(/left join/g)).toHaveLength(3);
	});

	it(oneLine`
		emits the same slice per composed path as the per-path queries did, for the old
		row and the committed one
	`, async () => {
		tracker.on.select('student_course').responseOnce([
			{ id: 1, teaching_unit: 10, '#path0': 20, '#path1': 30, '#path2': 'A' },
		]);

		tracker.on.update('student_course').response(1);

		// Every terminal differs from the old row's, so a column read off the wrong path
		// would surface as a wrong value rather than passing on a shared one.
		tracker.on.select('student_course').responseOnce([
			{ id: 1, teaching_unit: 11, '#path0': 21, '#path1': 31, '#path2': 'B' },
		]);

		await new ItemsService(
			'student_course',
			{ knex: db, schema: composedChainSchema },
		).updateMany([1], { teaching_unit: 11 });

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'student_course',
			[
				{
					collection: 'student_course',
					pinnedScope: {
						id: ['1'],
						teaching_unit: ['10'],
						'teaching_unit.discipline': ['20'],
						'teaching_unit.discipline.enrollment': ['30'],
						'teaching_unit.discipline.enrollment.student': ['a'],
					},
				},
				{
					collection: 'student_course',
					pinnedScope: {
						id: ['1'],
						teaching_unit: ['11'],
						'teaching_unit.discipline': ['21'],
						'teaching_unit.discipline.enrollment': ['31'],
						'teaching_unit.discipline.enrollment.student': ['b'],
					},
				},
			],
			expect.anything(),
			expect.anything(),
		);
	});

	it(oneLine`
		keeps two paths apart when their terminal fields share a name, instead of
		collapsing them onto one slice
	`, async () => {
		tracker.on.select('note').responseOnce([{
			id: 1,
			left_ref: 7,
			right_ref: 8,
			'#path0': 'left-owner',
			'#path1': 'right-owner',
		}]);

		tracker.on.delete('note').response(1);

		await new ItemsService('note', { knex: db, schema: sharedTerminalNameSchema })
			.deleteMany([1]);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'note',
			[
				{
					collection: 'note',
					pinnedScope: {
						id: ['1'],
						left_ref: ['7'],
						right_ref: ['8'],
						'left_ref.owner': ['left-owner'],
						'right_ref.owner': ['right-owner'],
					},
				},
			],
			expect.anything(),
			expect.anything(),
		);
	});
});

// A path whose first hop names no relation: collectionScopedCachePaths drops it
// before the snapshot runs, so one bad declaration must not cost its sibling.
const unresolvablePathSchema = new SchemaBuilder()
	.collection('note', (c) => {
		c.field('id').id();
		c.field('holder').m2o('holder');
	})
	.collection('holder', (c) => {
		c.field('id').id();
		c.field('owner').string();
	})
	.build();

const unresolvablePath = unresolvablePathSchema.collections;

unresolvablePath['note']!.scopedCacheFields = ['ghost.owner', 'holder'];
unresolvablePath['holder']!.scopedCacheFields = ['owner'];

describe('scoped cache path snapshot — rows and paths it has to survive', () => {
	let db: Knex;
	let tracker: Tracker;

	beforeAll(() => {
		db = knex.default({ client: MockClient });
		tracker = createTracker(db);
	});

	afterEach(() => {
		tracker.reset();
		purgeScopedCache.mockClear();
	});

	it(oneLine`
		emits each mutated row's own terminal when several keys are written at once,
		reading every path off that row rather than the first one
	`, async () => {
		tracker.on.select('student_course').responseOnce([
			{ id: 1, teaching_unit: 10, '#path0': 11, '#path1': 12, '#path2': 'A' },
			{ id: 2, teaching_unit: 20, '#path0': 21, '#path1': 22, '#path2': 'B' },
		]);

		tracker.on.delete('student_course').response(2);

		await new ItemsService(
			'student_course',
			{ knex: db, schema: composedChainSchema },
		).deleteMany([1, 2]);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			`student_course`,
			[
				{
					collection: 'student_course',
					pinnedScope: {
						id: ['1'],
						teaching_unit: ['10'],
						'teaching_unit.discipline': ['11'],
						'teaching_unit.discipline.enrollment': ['12'],
						'teaching_unit.discipline.enrollment.student': ['a'],
					},
				},
				{
					collection: 'student_course',
					pinnedScope: {
						id: ['2'],
						teaching_unit: ['20'],
						'teaching_unit.discipline': ['21'],
						'teaching_unit.discipline.enrollment': ['22'],
						'teaching_unit.discipline.enrollment.student': ['b'],
					},
				},
			],
			expect.anything(),
			expect.anything(),
		);
	});

	it(oneLine`
		keeps a row whose join chain resolves to nothing, as the null slice the read side
		pins, and collapses two such rows onto one tag
	`, async () => {
		tracker.on.select('student_course').responseOnce([
			{ id: 1, teaching_unit: 10, '#path0': 11, '#path1': 12, '#path2': 'A' },
			{ id: 2, teaching_unit: null, '#path0': null, '#path1': null, '#path2': null },
			{ id: 3, teaching_unit: null, '#path0': null, '#path1': null, '#path2': null },
		]);

		tracker.on.delete('student_course').response(3);

		await new ItemsService(
			'student_course',
			{ knex: db, schema: composedChainSchema },
		).deleteMany([1, 2, 3]);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			`student_course`,
			[
				{
					collection: 'student_course',
					pinnedScope: {
						id: ['1'],
						teaching_unit: ['10'],
						'teaching_unit.discipline': ['11'],
						'teaching_unit.discipline.enrollment': ['12'],
						'teaching_unit.discipline.enrollment.student': ['a'],
					},
				},
				{
					collection: 'student_course',
					pinnedScope: {
						id: ['2'],
						teaching_unit: ['\x00null'],
						'teaching_unit.discipline': ['\x00null'],
						'teaching_unit.discipline.enrollment': ['\x00null'],
						'teaching_unit.discipline.enrollment.student': ['\x00null'],
					},
				},
				{
					collection: 'student_course',
					pinnedScope: {
						id: ['3'],
						teaching_unit: ['\x00null'],
						'teaching_unit.discipline': ['\x00null'],
						'teaching_unit.discipline.enrollment': ['\x00null'],
						'teaching_unit.discipline.enrollment.student': ['\x00null'],
					},
				},
			],
			expect.anything(),
			expect.anything(),
		);
	});

	it(oneLine`
		leaves out a path the schema cannot resolve, and still emits its sibling's slice
	`, async () => {
		tracker.on.select('note')
			.responseOnce([{ id: 1, holder: 7, '#path0': 'owner-a' }]);

		tracker.on.delete('note').response(1);

		await new ItemsService(
			'note',
			{ knex: db, schema: unresolvablePathSchema },
		).deleteMany([1]);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			`note`,
			[
				{
					collection: 'note',
					pinnedScope: {
						id: ['1'],
						holder: ['7'],
						'holder.owner': ['owner-a'],
					},
				},
			],
			expect.anything(),
			expect.anything(),
		);
	});

	it(oneLine`
		emits no value slice at all when the snapshot query matches no row, leaving the
		key slices the caller already resolved
	`, async () => {
		tracker.on.select('student_course').responseOnce([]);
		tracker.on.delete('student_course').response(1);

		await new ItemsService(
			'student_course',
			{ knex: db, schema: composedChainSchema },
		).deleteMany([1]);

		// One query carries the flat columns and the path terminals both, so a row can
		// no longer be present for one and absent for the other.
		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			`student_course`,
			[
			],
			expect.anything(),
			expect.anything(),
		);
	});
});
