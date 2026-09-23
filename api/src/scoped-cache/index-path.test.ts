import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import { describe, expect, it } from 'vitest';
import { scopedCacheIndexPath } from './index-path.js';

// `slot` owns through `zone`, which owns through `region`, so its index path is
// two hops deep and the walk has a longest path to prefer. `note` scopes on a flat
// column alone, so it has no ancestor to index by.
const schema = new SchemaBuilder()
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
	.collection('note', (c) => {
		c.field('id').id();
		c.field('method').string();
		c.field('author').string();
	})
	.collection('loose', (c) => {
		c.field('id').id();
	})
	.build();

schema.collections['slot']!.scopedCacheFields = ['method', 'zone'];
schema.collections['zone']!.scopedCacheFields = ['region'];
schema.collections['region']!.scopedCacheFields = ['owner'];
schema.collections['note']!.scopedCacheFields = ['method', 'author'];

describe('scopedCacheIndexPath', () => {
	it('follows the index path to its deepest ancestor key', () => {
		expect(scopedCacheIndexPath(schema, 'slot')).toBe('zone.region.owner');
	});

	it('stops at the ancestor a shorter chain reaches', () => {
		expect(scopedCacheIndexPath(schema, 'zone')).toBe('region.owner');
	});

	it(oneLine`
		falls back to the first field a collection scoping only on its own columns
		declares
	`, () => {
		expect(scopedCacheIndexPath(schema, 'note')).toBe('method');
	});

	it('has no path for a collection declaring no scope at all', () => {
		expect(scopedCacheIndexPath(schema, 'loose')).toBe(null);
	});
});
