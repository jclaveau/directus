import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import knex from 'knex';
import { MockClient, createTracker, type Tracker } from 'knex-mock-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemScopedCacheService } from './item-scoped-cache-service.js';

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
});

// `item` scopes on two flat columns, and on the owner its `parent` M2O leads to, so
// one mutated row of it carries a pair per axis a read of it can pin itself to.
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

	// The whole point of a composite tag: a read pinned to BOTH owner=alpha and
	// method=slow depends on neither of these rows, and would be purged by them if
	// their values were emitted as separate tags to be matched one at a time.
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

	it('snapshots nothing for a collection absent from the schema', async () => {
		const scopedCache =
			new ItemScopedCacheService('unknown', schema, db, null, null);

		expect(await scopedCache.snapshot([1])).toEqual({
			canResolveSlicesFromRows: true,
			rows: [],
		});
	});
});

