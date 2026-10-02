import type { Accountability } from '@directus/types';
import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import knex from 'knex';
import { MockClient, createTracker, type Tracker } from 'knex-mock-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scopedCacheIndexPath } from './index-path.js';
import type Keyv from 'keyv';
import { transaction } from '../utils/transaction.js';
import { ItemScopedCacheService } from './item-scoped-cache-service.js';
import { purgeScopedCache } from './purge.js';

vi.mock('./purge.js', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('./purge.js')>()),
		purgeScopedCache: vi.fn(async () => []),
	};
});

vi.mock('./config.js', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('./config.js')>()),
		scopedCachePurgeEnabled: () => purgeEnabled,
	};
});

let purgeEnabled = true;
let db: knex.Knex;
let tracker: Tracker;

beforeEach(() => {
	purgeEnabled = true;
	db = knex.default({ client: MockClient });
	tracker = createTracker(db);
});

afterEach(() => {
	tracker.reset();
	vi.mocked(purgeScopedCache).mockClear();
});

// `item` scopes on two flat columns, and on the owner its `parent` M2O leads to, so
// one mutated row of it carries a pin per axis a read of it can pin itself to.
const schema = new SchemaBuilder()
	.collection('item', (c) => {
		c.field('id').id();
		c.field('owner').string();
		c.field('method').string();
		c.field('parent').m2o('zone');
	})
	.collection('zone', (c) => {
		c.field('id').id();
		c.field('area').string();
	})
	.build();

schema.collections['item']!.scopedCacheFields = [
	'owner',
	'method',
	'parent.area',
];

describe('snapshot', () => {
	it(oneLine`
		snapshots one row as one fingerprint, holding every axis it sits on
	`, async () => {
		tracker.on.select('item').response([
			{ id: 1, owner: 'alpha', method: 'spaced', parent: 9, '#path0': 'north' },
		]);

		const scopedCache =
			new ItemScopedCacheService('item', schema, db, null, null);

		expect(await scopedCache.snapshot([1])).toEqual({
			canResolveSlicesFromRows: true,
			rows: [
				{
					key: 1,
					// Every column, not only the axes: the `changed` diff reads this
					// row, and a read binds fields no scope ever names.
					row: {
						id: 1,
						owner: 'alpha',
						method: 'spaced',
						parent: 9,
						'parent.area': 'north',
					},
					fingerprint: {
						collection: 'item',
						pinnedScope: {
							id: ['1'],
							method: ['spaced'],
							owner: ['alpha'],
							'parent.area': ['north'],
						},
					},
				},
			],
		});
	});

	// The whole point of a composite fingerprint: a read pinned to BOTH
	// owner=alpha and method=slow depends on neither of these rows, and would be
	// purged by them if their values were emitted as separate pins to be
	// matched one at a time.
	it('keeps two rows apart rather than pooling their values', async () => {
		tracker.on.select('item').response([
			{ id: 1, owner: 'alpha', method: 'spaced', parent: 9, '#path0': 'north' },
			{ id: 2, owner: 'beta', method: 'slow', parent: 8, '#path0': 'south' },
		]);

		const scopedCache =
			new ItemScopedCacheService('item', schema, db, null, null);

		const { rows } = await scopedCache.snapshot([1, 2]);

		expect(rows).toEqual([
			{
				key: 1,
				row: {
					id: 1,
					owner: 'alpha',
					method: 'spaced',
					parent: 9,
					'parent.area': 'north',
				},
				fingerprint: {
					collection: 'item',
					pinnedScope: {
						id: ['1'],
						method: ['spaced'],
						owner: ['alpha'],
						'parent.area': ['north'],
					},
				},
			},
			{
				key: 2,
				row: {
					id: 2,
					owner: 'beta',
					method: 'slow',
					parent: 8,
					'parent.area': 'south',
				},
				fingerprint: {
					collection: 'item',
					pinnedScope: {
						id: ['2'],
						method: ['slow'],
						owner: ['beta'],
						'parent.area': ['south'],
					},
				},
			},
		]);
	});

	it(oneLine`
		snapshots a null column as the sentinel a read pinning null also renders
	`, async () => {
		tracker.on.select('item').response([
			{ id: 3, owner: null, method: 'spaced', parent: null, '#path0': null },
		]);

		const scopedCache =
			new ItemScopedCacheService('item', schema, db, null, null);

		const { rows } = await scopedCache.snapshot([3]);

		expect(rows).toEqual([
			{
				key: 3,
				row: {
					id: 3,
					owner: null,
					method: 'spaced',
					parent: null,
					'parent.area': null,
				},
				fingerprint: {
					collection: 'item',
					pinnedScope: {
						id: ['3'],
						method: ['spaced'],
						owner: ['\x00null'],
						'parent.area': ['\x00null'],
					},
				},
			},
		]);
	});

	// A collection declaring no scope field still pins its key axis on both sides,
	// so a read of one row is purged by a write to that row and by no other. Its
	// columns are never read — no query is issued at all — so the row rides as
	// `null` and every update of it reads as touching every field.
	it('snapshots the key axis of a collection scoping on nothing', async () => {
		const scopedCache =
			new ItemScopedCacheService('zone', schema, db, null, null);

		expect(await scopedCache.snapshot([7])).toEqual({
			canResolveSlicesFromRows: true,
			rows: [
				{
					key: 7,
					row: null,
					fingerprint: {
						collection: 'zone',
						pinnedScope: { id: ['7'] },
					},
				},
			],
		});
	});

	it(oneLine`
		snapshots nothing for no keys, which a collection-wide purge already covers
	`, async () => {
		const scopedCache =
			new ItemScopedCacheService('item', schema, db, null, null);

		expect(await scopedCache.snapshot([]))
			.toEqual({ canResolveSlicesFromRows: true, rows: [] });
	});

	it(oneLine`
		snapshots nothing while scoped purging is off, since a full flush follows
	`, async () => {
		purgeEnabled = false;

		const scopedCache =
			new ItemScopedCacheService('item', schema, db, null, null);

		expect(await scopedCache.snapshot([1]))
			.toEqual({ canResolveSlicesFromRows: true, rows: [] });
	});

	// The index sets a write reads are named by the row's value at the index path,
	// so a row that could come back without one would read the bare set alone and
	// miss every read filed under its old value. The path is one the row always
	// resolves: an ancestor that is gone joins as null and pins as null.
	it(oneLine`
		pins the index path of a row whose ancestors are gone, as null
	`, async () => {
		const chainSchema = new SchemaBuilder()
			.collection('slot', (c) => {
				c.field('id').id();
				c.field('method').string();
				c.field('zone').m2o('zone');
			})
			.collection('zone', (c) => {
				c.field('id').id();
				c.field('region').m2o('region');
			})
			.collection('region', (c) => {
				c.field('id').id();
				c.field('owner').string();
			})
			.build();

		chainSchema.collections['slot']!.scopedCacheFields = ['method', 'zone'];
		chainSchema.collections['zone']!.scopedCacheFields = ['region'];
		chainSchema.collections['region']!.scopedCacheFields = ['owner'];

		tracker.on.select('slot').response([
			{ id: 1, method: 'spaced', zone: 4, '#path0': null, '#path1': null },
		]);

		const scopedCache =
			new ItemScopedCacheService('slot', chainSchema, db, null, null);

		expect(scopedCacheIndexPath(chainSchema, 'slot')).toBe('zone.region.owner');

		expect(await scopedCache.snapshot([1])).toEqual({
			canResolveSlicesFromRows: true,
			rows: [
				{
					key: 1,
					row: {
						id: 1,
						method: 'spaced',
						zone: 4,
						'zone.region': null,
						'zone.region.owner': null,
					},
					fingerprint: {
						collection: 'slot',
						pinnedScope: {
							id: ['1'],
							method: ['spaced'],
							zone: ['4'],
							'zone.region': ['\x00null'],
							'zone.region.owner': ['\x00null'],
						},
					},
				},
			],
		});
	});

	it('snapshots nothing for a collection absent from the schema', async () => {
		const scopedCache =
			new ItemScopedCacheService('unknown', schema, db, null, null);

		expect(await scopedCache.snapshot([1])).toEqual({
			canResolveSlicesFromRows: true,
			rows: [],
		});
	});
});

describe('purge', () => {
	it('purges at once on a knex that is no transaction', async () => {
		const cache = {} as Keyv;

		const scopedCache = new ItemScopedCacheService(
			'item',
			schema,
			db,
			cache,
			null,
		);

		await scopedCache.purge([
			{ collection: 'item', pinnedScope: { owner: ['alpha'] } },
		]);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			cache,
			'item',
			[{ collection: 'item', pinnedScope: { owner: ['alpha'] } }],
			{ database: db, schema, accountability: null },
			{ declaredFingerprints: [], changedCollections: [] },
		);
	});

	it(oneLine`
		waits for the transaction a nested write runs in to commit, then purges on
		the connection that transaction was opened on (#363)
	`, async () => {
		const cache = {} as Keyv;

		await transaction(db, async (trx) => {
			const scopedCache = new ItemScopedCacheService(
				'item',
				schema,
				trx,
				cache,
				null,
			);

			expect(await scopedCache.purge([
				{ collection: 'item', pinnedScope: { owner: ['alpha'] } },
			])).toEqual([]);

			expect(purgeScopedCache).not.toHaveBeenCalled();
		});

		expect(purgeScopedCache).toHaveBeenCalledWith(
			cache,
			'item',
			[{ collection: 'item', pinnedScope: { owner: ['alpha'] } }],
			{ database: db, schema, accountability: null },
			{ declaredFingerprints: [], changedCollections: [] },
		);
	});

	it(oneLine`
		purges after commit the hook declarations it was handed, not the ones
		declared after it
	`, async () => {
		const cache = {} as Keyv;

		const hookDeclarations = {
			purgeFingerprints: [{ collection: 'item', pinnedScope: { owner: ['alpha'] } }],
		};

		await transaction(db, async (trx) => {
			await new ItemScopedCacheService(
				'item',
				schema,
				trx,
				cache,
				null,
			).purge([], hookDeclarations);

			hookDeclarations.purgeFingerprints.push({
				collection: 'item',
				pinnedScope: { owner: ['beta'] },
			});
		});

		expect(purgeScopedCache).toHaveBeenCalledWith(
			cache,
			'item',
			[],
			{ database: db, schema, accountability: null },
			{
				declaredFingerprints: [
					{ collection: 'item', pinnedScope: { owner: ['alpha'] } },
				],
				changedCollections: [],
			},
		);
	});

	it(oneLine`
		purges once after commit for every write a hook made per row on one
		collection, with their rows merged (#594)
	`, async () => {
		const cache = {} as Keyv;

		await transaction(db, async (trx) => {
			await new ItemScopedCacheService('item', schema, trx, cache, null).purge(
				[{ collection: 'item', pinnedScope: { owner: ['alpha'] } }],
				undefined,
				[],
				{
					rows: {
						fingerprints: [
							{ collection: 'item', pinnedScope: { owner: ['alpha'] } },
						],
						changed: ['method'],
					},
				},
			);

			await new ItemScopedCacheService('item', schema, trx, cache, null).purge(
				[{ collection: 'item', pinnedScope: { owner: ['beta'] } }],
				undefined,
				[],
				{
					rows: {
						fingerprints: [{ collection: 'item', pinnedScope: { owner: ['beta'] } }],
						changed: ['owner', 'method'],
					},
				},
			);
		});

		expect(vi.mocked(purgeScopedCache).mock.calls).toEqual([[
			cache,
			'item',
			[
				{ collection: 'item', pinnedScope: { owner: ['alpha'] } },
				{ collection: 'item', pinnedScope: { owner: ['beta'] } },
			],
			{ database: db, schema, accountability: null },
			{
				rowFingerprints: [
					{ collection: 'item', pinnedScope: { owner: ['alpha'] } },
					{ collection: 'item', pinnedScope: { owner: ['beta'] } },
				],
				changed: ['method', 'owner'],
				indexPath: 'owner',
				declaredFingerprints: [],
				changedCollections: [],
			},
		]]);
	});

	it(oneLine`
		merges the fingerprints two writes of one row both hold into one of each, as
		writes sharing a declarations sink each hold all declared so far
	`, async () => {
		const cache = {} as Keyv;

		await transaction(db, async (trx) => {
			await new ItemScopedCacheService('item', schema, trx, cache, null).purge(
				[{ collection: 'item', pinnedScope: { owner: ['alpha'] } }],
				{
					purgeFingerprints: [
						{ collection: 'zone', pinnedScope: { area: ['north'] } },
					],
				},
				[],
				{
					rows: {
						fingerprints: [
							{ collection: 'item', pinnedScope: { owner: ['alpha'] } },
						],
						changed: ['method'],
					},
				},
			);

			await new ItemScopedCacheService('item', schema, trx, cache, null).purge(
				[{ collection: 'item', pinnedScope: { owner: ['alpha'] } }],
				{
					purgeFingerprints: [
						{ collection: 'zone', pinnedScope: { area: ['north'] } },
						{ collection: 'zone', pinnedScope: { area: ['south'] } },
					],
				},
				[],
				{
					rows: {
						fingerprints: [
							{ collection: 'item', pinnedScope: { owner: ['alpha'] } },
						],
						changed: ['method'],
					},
				},
			);
		});

		expect(vi.mocked(purgeScopedCache).mock.calls).toEqual([[
			cache,
			'item',
			[{ collection: 'item', pinnedScope: { owner: ['alpha'] } }],
			{ database: db, schema, accountability: null },
			{
				rowFingerprints: [
					{ collection: 'item', pinnedScope: { owner: ['alpha'] } },
				],
				changed: ['method'],
				indexPath: 'owner',
				declaredFingerprints: [
					{ collection: 'zone', pinnedScope: { area: ['north'] } },
					{ collection: 'zone', pinnedScope: { area: ['south'] } },
				],
				changedCollections: [],
			},
		]]);
	});

	it(oneLine`
		merges a purge without rows into one that has rows as a purge without rows,
		which drops every entry its fingerprints reach
	`, async () => {
		const cache = {} as Keyv;

		await transaction(db, async (trx) => {
			await new ItemScopedCacheService('item', schema, trx, cache, null).purge(
				[{ collection: 'item', pinnedScope: { owner: ['alpha'] } }],
				undefined,
				[],
				{
					rows: {
						fingerprints: [
							{ collection: 'item', pinnedScope: { owner: ['alpha'] } },
						],
						changed: null,
					},
				},
			);

			await new ItemScopedCacheService('item', schema, trx, cache, null).purge(
				[{ collection: 'item', pinnedScope: { owner: ['beta'] } }],
				{
					purgeFingerprints: [
						{ collection: 'zone', pinnedScope: { area: ['north'] } },
					],
				},
				['zone'],
			);
		});

		expect(vi.mocked(purgeScopedCache).mock.calls).toEqual([
			[
				cache,
				'item',
				[
					{ collection: 'item', pinnedScope: { owner: ['alpha'] } },
					{ collection: 'item', pinnedScope: { owner: ['beta'] } },
				],
				{ database: db, schema, accountability: null },
				{
					declaredFingerprints: [
						{ collection: 'zone', pinnedScope: { area: ['north'] } },
					],
					changedCollections: ['zone'],
					scopedCachePurgeId: expect.any(String),
				},
			],
			[
				cache,
				'zone',
				null,
				{ database: db, schema, accountability: null },
				{ scopedCachePurgeId: expect.any(String) },
			],
		]);
	});

	it(oneLine`
		purges apart after commit the writes of different collections, and those
		keeping the bare fingerprint warm
	`, async () => {
		const cache = {} as Keyv;

		await transaction(db, async (trx) => {
			await new ItemScopedCacheService('item', schema, trx, cache, null)
				.purge([{ collection: 'item', pinnedScope: { owner: ['alpha'] } }]);

			await new ItemScopedCacheService('zone', schema, trx, cache, null)
				.purge([{ collection: 'zone', pinnedScope: { area: ['north'] } }]);

			await new ItemScopedCacheService('item', schema, trx, cache, null).purge(
				[{ collection: 'item', pinnedScope: { owner: ['beta'] } }],
				undefined,
				[],
				{ includeBareFingerprint: false },
			);
		});

		expect(vi.mocked(purgeScopedCache).mock.calls).toEqual([
			[
				cache,
				'item',
				[{ collection: 'item', pinnedScope: { owner: ['alpha'] } }],
				{ database: db, schema, accountability: null },
				{ declaredFingerprints: [], changedCollections: [] },
			],
			[
				cache,
				'zone',
				[{ collection: 'zone', pinnedScope: { area: ['north'] } }],
				{ database: db, schema, accountability: null },
				{ declaredFingerprints: [], changedCollections: [] },
			],
			[
				cache,
				'item',
				[{ collection: 'item', pinnedScope: { owner: ['beta'] } }],
				{ database: db, schema, accountability: null },
				{
					declaredFingerprints: [],
					changedCollections: [],
					includeBareFingerprint: false,
				},
			],
		]);
	});

	it(oneLine`
		purges apart after commit the writes of one collection made under different
		accountabilities, each handed its own
	`, async () => {
		const cache = {} as Keyv;
		const editor = { user: 'editor', role: 'editor-role' } as Accountability;

		await transaction(db, async (trx) => {
			await new ItemScopedCacheService('item', schema, trx, cache, null)
				.purge([{ collection: 'item', pinnedScope: { owner: ['alpha'] } }]);

			await new ItemScopedCacheService('item', schema, trx, cache, editor)
				.purge([{ collection: 'item', pinnedScope: { owner: ['beta'] } }]);
		});

		expect(vi.mocked(purgeScopedCache).mock.calls).toEqual([
			[
				cache,
				'item',
				[{ collection: 'item', pinnedScope: { owner: ['alpha'] } }],
				{ database: db, schema, accountability: null },
				{ declaredFingerprints: [], changedCollections: [] },
			],
			[
				cache,
				'item',
				[{ collection: 'item', pinnedScope: { owner: ['beta'] } }],
				{
					database: db,
					schema,
					accountability: { user: 'editor', role: 'editor-role' },
				},
				{ declaredFingerprints: [], changedCollections: [] },
			],
		]);
	});

	it(oneLine`
		merges a purge of the whole collection into a row-bound one as a purge of the
		whole collection
	`, async () => {
		const cache = {} as Keyv;

		await transaction(db, async (trx) => {
			await new ItemScopedCacheService('item', schema, trx, cache, null).purge(
				[{ collection: 'item', pinnedScope: { owner: ['alpha'] } }],
				undefined,
				[],
				{
					rows: {
						fingerprints: [
							{ collection: 'item', pinnedScope: { owner: ['alpha'] } },
						],
						changed: ['method'],
					},
				},
			);

			await new ItemScopedCacheService('item', schema, trx, cache, null)
				.purge(null);
		});

		expect(vi.mocked(purgeScopedCache).mock.calls).toEqual([[
			cache,
			'item',
			null,
			{ database: db, schema, accountability: null },
			{ scopedCachePurgeId: expect.any(String) },
		]]);
	});

	it(oneLine`
		merges a row that entered or left the result set as one changing every
		field
	`, async () => {
		const cache = {} as Keyv;

		await transaction(db, async (trx) => {
			await new ItemScopedCacheService('item', schema, trx, cache, null).purge(
				[{ collection: 'item', pinnedScope: { owner: ['alpha'] } }],
				undefined,
				[],
				{
					rows: {
						fingerprints: [
							{ collection: 'item', pinnedScope: { owner: ['alpha'] } },
						],
						changed: ['method'],
					},
				},
			);

			await new ItemScopedCacheService('item', schema, trx, cache, null).purge(
				[{ collection: 'item', pinnedScope: { owner: ['beta'] } }],
				undefined,
				[],
				{
					rows: {
						fingerprints: [
							{ collection: 'item', pinnedScope: { owner: ['beta'] } },
						],
						changed: null,
					},
				},
			);
		});

		expect(vi.mocked(purgeScopedCache).mock.calls).toEqual([[
			cache,
			'item',
			[
				{ collection: 'item', pinnedScope: { owner: ['alpha'] } },
				{ collection: 'item', pinnedScope: { owner: ['beta'] } },
			],
			{ database: db, schema, accountability: null },
			{
				rowFingerprints: [
					{ collection: 'item', pinnedScope: { owner: ['alpha'] } },
					{ collection: 'item', pinnedScope: { owner: ['beta'] } },
				],
				changed: null,
				indexPath: 'owner',
				declaredFingerprints: [],
				changedCollections: [],
			},
		]]);
	});
});
