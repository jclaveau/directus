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

function serviceFor(collection: string) {
	return new ItemScopedCacheService(collection, schema, db, null, null);
}

describe('fingerprintsFromPks', () => {
	it(oneLine`
		writes one row as one fingerprint, holding every axis it sits on
	`, async () => {
		tracker.on.select('item').response([
			{ id: 1, owner: 'alpha', method: 'spaced', value0: 'north' },
		]);

		expect(await serviceFor('item').fingerprintsFromPks([1])).toEqual([
			'item:&id=,1,&method=,spaced,&owner=,alpha,&parent.area=,north,&',
		]);
	});

	// The whole point of a composite tag: a read pinned to BOTH owner=alpha and
	// method=slow depends on neither of these rows, and would be purged by them if
	// their values were emitted as separate tags to be matched one at a time.
	it('keeps two rows apart rather than pooling their values', async () => {
		tracker.on.select('item').response([
			{ id: 1, owner: 'alpha', method: 'spaced', value0: 'north' },
			{ id: 2, owner: 'beta', method: 'slow', value0: 'south' },
		]);

		expect(await serviceFor('item').fingerprintsFromPks([1, 2])).toEqual([
			'item:&id=,1,&method=,spaced,&owner=,alpha,&parent.area=,north,&',
			'item:&id=,2,&method=,slow,&owner=,beta,&parent.area=,south,&',
		]);
	});

	it(oneLine`
		writes a null column as the sentinel a read pinning null also renders
	`, async () => {
		tracker.on.select('item').response([
			{ id: 3, owner: null, method: 'spaced', value0: null },
		]);

		expect(await serviceFor('item').fingerprintsFromPks([3])).toEqual([
			'item:&id=,3,&method=,spaced,&owner=,\x00null,&parent.area=,\x00null,&',
		]);
	});

	// A collection declaring no scope field still pins its key axis on both sides,
	// so a read of one row is purged by a write to that row and by no other.
	it('writes the key axis of a collection scoping on nothing', async () => {
		tracker.on.select('zone').response([{ id: 7 }]);

		expect(await serviceFor('zone').fingerprintsFromPks([7])).toEqual([
			'zone:&id=,7,&',
		]);
	});

	it(oneLine`
		writes nothing for no keys, which a collection-wide purge already covers
	`, async () => {
		expect(await serviceFor('item').fingerprintsFromPks([])).toEqual([]);
	});

	it(oneLine`
		writes nothing while scoped purging is off, since a full flush follows
	`, async () => {
		purgeEnabled = false;

		expect(await serviceFor('item').fingerprintsFromPks([1])).toEqual([]);
	});

	it('writes nothing for a collection absent from the schema', async () => {
		expect(await serviceFor('unknown').fingerprintsFromPks([1])).toEqual([]);
	});
});
