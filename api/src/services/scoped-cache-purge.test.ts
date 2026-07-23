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
	CACHE_NAMESPACE: 'scalabus',
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
		// snapshotScopedCacheTags reads the pre-update row (old = A), then re-reads the
		// committed row after the write (new = B) — the stored row is authoritative, not the
		// payload, so a trigger/coercion rewrite still resolves the right slice. old ∪ new.
		tracker.on.select('test').responseOnce([{ id: 1, student: 'A' }]);
		tracker.on.select('test').responseOnce([{ id: 1, student: 'B' }]);
		tracker.on.update('test').response(1);

		await service().updateMany([1], { student: 'B' });

		expect(purgeScopedCache).toHaveBeenCalledTimes(1);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[
				{ collection: 'test', field: 'student', value: 'A', type: 'string' },
				{ collection: 'test', field: 'student', value: 'B', type: 'string' },
			],
			expect.anything(),
		);
	});

	it(oneLine`
		updateMany that leaves the scope field untouched still purges the captured slice —
		old and re-read new both resolve to A
	`, async () => {
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.update('test').response(1);

		await service().updateMany([1], { name: 'renamed' });

		// Exact, not arrayContaining: the tags are old ∪ new, so an unchanged value repeats
		// (the real purge dedups via a Set on the tag key). Pinning the whole array also
		// witnesses that no OTHER slice leaks in.
		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[
				{ collection: 'test', field: 'student', value: 'A', type: 'string' },
				{ collection: 'test', field: 'student', value: 'A', type: 'string' },
			],
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
				{ collection: 'test', field: 'student', value: 'A', type: 'string' },
				{ collection: 'test', field: 'student', value: 'B', type: 'string' },
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

		// Pure insert → empty old snapshot, so the new slice is the whole tag set (exact).
		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[{ collection: 'test', field: 'student', value: 'A', type: 'string' }],
			expect.anything(),
		);
	});

	it(oneLine`
		upsertMany (update) captures the pre-update slice — a keyed payload snapshots old
		before the write (old ∪ new)
	`, async () => {
		// The payload carries the key → upsertOne takes the update path; the pre-snapshot
		// reads the old slice (A) before the update runs. arrayContaining (not exact): upsert
		// issues a non-fixed number of selects, so the old ∪ new tag count isn't pinnable — the
		// A→B exact-union witness lives in the updateMany test above.
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.update('test').response(1);

		await service().upsertMany([{ id: 1, name: 'a', student: 'B' }]);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			expect.arrayContaining([
				{ collection: 'test', field: 'student', value: 'A', type: 'string' },
			]),
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

		// Name-only change → scope stays A, so old ∪ new repeats it (exact; real purge dedups).
		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[
				{ collection: 'test', field: 'student', value: 'A', type: 'string' },
				{ collection: 'test', field: 'student', value: 'A', type: 'string' },
			],
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
				[{ collection: 'test', field: 'student', value: 'B', type: 'string' }],
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
			[{ collection: 'test', field: 'student', value: 'default-owner', type: 'string' }],
			expect.anything(),
		);
	});

	it(oneLine`
		create with a NULL scope value purges that null slice — a present-but-null value is a
		real slice (canonical \x00null tag), not the coarse fallback
	`, async () => {
		// The committed row resolves `student` to NULL (unset column, DB default null). The field
		// key IS present, so it's a precise null-slice purge — distinct from a MISSING field key,
		// which is the coarse (null-tags) fallback above. A read filtered `student: { _eq: null }`
		// pins the same slice, so the two sides meet.
		tracker.on.insert('test').response([1]);
		tracker.on.select('test').response([{ id: 1, student: null }]);

		await service().createMany([{ name: 'x' }]);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			expect.anything(),
			'test',
			[{ collection: 'test', field: 'student', value: null, type: 'string' }],
			expect.anything(),
		);
	});

	it(oneLine`
		an UNDECLARED take-over falls back to a coarse purge (null) — a take-over can be
		an update-in-disguise whose OLD slice the create path can't recover
	`, async () => {
		// The hook returns a PK but declares nothing. It might have moved that row
		// between slices (an upsert), and createMany has no old∪new capture → the old
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
		);
		}
		finally {
			emitter.offFilter('test.items.create', takeOver);
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
					{ collection: 'test', field: 'student', value: 'A', type: 'string' },
					{ collection: 'test', field: 'student', value: 'C', type: 'string' },
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
			{ collection: 'test', field: 'student', value: 'A', type: 'string' },
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

			// The `cache.scope` listener adds these tags itself (no schema type on hand), so
			// they stay untyped — an extension owns both sides of its own tags.
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

	// `context.scopedCache` carries only the event's method: an `items.read` filter
	// scopes the response via `scopeTo`; a create/update/delete filter purges via
	// `purgeBy`. Additive to the framework tags — read tags into the meta rider,
	// mutation tags into the purge.
	describe('context.scopedCache scopeTo / purgeBy hooks', () => {
		// A cross-collection dependency a hook declares (a read enriched from an authors
		// row); shared so the hook's tag and the assertion can't drift.
		const authorsDependency = { collection: 'authors', field: 'id', value: 5 };

		it(oneLine`
			an items.read hook scopes the response to a cross-collection tag, unioned with
			the auto-derived collection tag on the meta rider
		`, async () => {
			tracker.on.select('test').response([{ id: 1, name: 'a', student: 'A' }]);

			const declare = async (payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.scopeTo(authorsDependency);
				return payload;
			};

			emitter.onFilter('test.items.read', declare);

			try {
				const result = await service().readByQuery({});

				expect(readMeta(result)?.scopedCacheTags).toEqual([
					{ collection: 'test' },
					authorsDependency,
				]);
			}
			finally {
				emitter.offFilter('test.items.read', declare);
			}
		});

		it(oneLine`
			an items.create hook adds a tag, unioned after the committed-row slice in the
			purge
		`, async () => {
			tracker.on.insert('test').response([1]);
			tracker.on.select('test').response([{ id: 1, student: 'A' }]);

			const declare = async (payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.purgeBy(authorsDependency);
				return payload;
			};

			emitter.onFilter('test.items.create', declare);

			try {
				await service().createMany([{ name: 'x', student: 'A' }]);

				expect(purgeScopedCache).toHaveBeenCalledWith(
					expect.anything(),
					'test',
					[
						{ collection: 'test', field: 'student', value: 'A', type: 'string' },
						authorsDependency,
					],
					expect.anything(),
				);
			}
			finally {
				emitter.offFilter('test.items.create', declare);
			}
		});

		it(oneLine`
			an items.update hook adds a tag, unioned after the old ∪ new slices in the
			purge
		`, async () => {
			tracker.on.select('test').responseOnce([{ id: 1, student: 'A' }]);
			tracker.on.select('test').responseOnce([{ id: 1, student: 'B' }]);
			tracker.on.update('test').response(1);

			const declare = async (payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.purgeBy(authorsDependency);
				return payload;
			};

			emitter.onFilter('test.items.update', declare);

			try {
				await service().updateMany([1], { student: 'B' });

				expect(purgeScopedCache).toHaveBeenCalledWith(
					expect.anything(),
					'test',
					[
						{ collection: 'test', field: 'student', value: 'A', type: 'string' },
						{ collection: 'test', field: 'student', value: 'B', type: 'string' },
						authorsDependency,
					],
					expect.anything(),
				);
			}
			finally {
				emitter.offFilter('test.items.update', declare);
			}
		});

		it(oneLine`
			an items.delete hook adds a tag, unioned after the deleted rows' slices in the
			purge
		`, async () => {
			tracker.on.select('test').response([{ id: 1, student: 'A' }]);
			tracker.on.delete('test').response(1);

			const declare = async (keys: any, _meta: any, ctx: any) => {
				ctx.scopedCache.purgeBy(authorsDependency);
				return keys;
			};

			emitter.onFilter('test.items.delete', declare);

			try {
				await service().deleteMany([1]);

				expect(purgeScopedCache).toHaveBeenCalledWith(
					expect.anything(),
					'test',
					[
						{ collection: 'test', field: 'student', value: 'A', type: 'string' },
						authorsDependency,
					],
					expect.anything(),
				);
			}
			finally {
				emitter.offFilter('test.items.delete', declare);
			}
		});

		it(oneLine`
			a take-over that DECLARES its footprint via addTag narrows to a precise purge —
			the declaration opts out of the safe coarse fallback
		`, async () => {
			// A take-over is coarse BY DEFAULT (old slice unrecoverable in the create
			// path). Declaring a tag asserts the hook knows its footprint, so we trust it
			// and narrow: the taken-over row's re-read slice (Z) UNION the declared tag —
			// never the coarse null flush.
			tracker.on.select('test').response([{ id: 99, student: 'Z' }]);

			const takeOver = async (_payload: any, _meta: any, ctx: any) => {
				ctx.scopedCache.purgeBy(authorsDependency);
				return 99;
			};

			emitter.onFilter('test.items.create', takeOver);

			try {
				await service().createMany([{ name: 'x', student: 'A' }]);

				expect(purgeScopedCache).toHaveBeenCalledWith(
					expect.anything(),
					'test',
					[
						{ collection: 'test', field: 'student', value: 'Z', type: 'string' },
						authorsDependency,
					],
					expect.anything(),
				);

				expect(purgeScopedCache).not.toHaveBeenCalledWith(
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
	});
});
