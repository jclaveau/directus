import { SchemaBuilder } from '@directus/schema-builder';
import type { Filter } from '@directus/types';
import { describe, expect, it } from 'vitest';
import { expandRelatedKeyFilters } from './expand-related-key-filters.js';

const schema = new SchemaBuilder()
	.collection('owned_item', (c) => {
		c.field('id').id();
		c.field('label').string();
		c.field('owner').m2o('owner');
		c.field('owned_sub_items').o2m('owned_sub_item', 'owned_item');
		c.field('categories').m2m('category');
	})
	.collection('owner', (c) => {
		c.field('id').id();
		c.field('name').string();
	})
	.collection('owned_sub_item', (c) => {
		c.field('id').id();
		c.field('owned_item').m2o('owned_item');
	})
	.collection('category', (c) => {
		c.field('id').id();
	})
	.build();

function expand(filter: unknown): Filter {
	return expandRelatedKeyFilters(schema, 'owned_item', filter as Filter);
}

describe('expandRelatedKeyFilters', () => {
	it('reads a leaf carrying no operator as `_eq`', () => {
		expect(expand({ label: 'a' })).toEqual({ label: { _eq: 'a' } });
	});

	it('moves an operator on a to-many alias onto the related key', () => {
		// `getColumnPath` appends the related primary key to a path ending on an
		// alias field, so this is the shape the join is actually built from.
		expect(expand({ owned_sub_items: { _eq: 7 } }))
			.toEqual({ owned_sub_items: { id: { _eq: 7 } } });
	});

	it('reads a bare value on a to-many alias the same way', () => {
		expect(expand({ owned_sub_items: 7 }))
			.toEqual({ owned_sub_items: { id: { _eq: 7 } } });
	});

	it('moves any operator, not only the ones that name a row', () => {
		expect(expand({ owned_sub_items: { _gt: 7 } }))
			.toEqual({ owned_sub_items: { id: { _gt: 7 } } });
	});

	it('resolves an M2M alias to its junction, as getColumnPath does', () => {
		expect(expand({ categories: { _eq: 7 } })).toEqual({
			categories: { id: { _eq: 7 } },
		});
	});

	it('leaves an M2O alone, whose foreign key is a column of this collection', () => {
		// `{ owner: { _eq: 7 } }` compiles to `owner = ?` with no join, so
		// expanding it would invent a dependency the query does not have.
		expect(expand({ owner: { _eq: 7 } })).toEqual({ owner: { _eq: 7 } });
		expect(expand({ owner: 7 })).toEqual({ owner: { _eq: 7 } });
	});

	it('leaves a path that already names a further field untouched', () => {
		expect(expand({ owned_sub_items: { id: { _eq: 7 } } }))
			.toEqual({ owned_sub_items: { id: { _eq: 7 } } });
	});

	it('expands inside every branch of a logical operator', () => {
		expect(expand({
			_or: [
				{ owned_sub_items: { _eq: 7 } },
				{ _and: [{ owned_sub_items: 8 }, { label: 'a' }] },
			],
		})).toEqual({
			_or: [
				{ owned_sub_items: { id: { _eq: 7 } } },
				{
					_and: [
						{ owned_sub_items: { id: { _eq: 8 } } },
						{ label: { _eq: 'a' } },
					],
				},
			],
		});
	});

	it('expands under a quantifier without crossing a relation twice', () => {
		expect(expand({ owned_sub_items: { _some: { id: 7 } } }))
			.toEqual({ owned_sub_items: { _some: { id: { _eq: 7 } } } });
	});

	it('expands each hop of a multi-hop path against its own collection', () => {
		expect(expand({ owner: { name: 'alice' } }))
			.toEqual({ owner: { name: { _eq: 'alice' } } });
	});

	it('leaves a function key alone, which reads every related row', () => {
		// `count(owned_sub_items) = 1` compares a cardinality, not a row key.
		// Moving the operator onto the related primary key would read it as
		// `owned_sub_items.id = 1` and name a row the filter never named.
		expect(expand({ 'count(owned_sub_items)': { _eq: 1 } }))
			.toEqual({ 'count(owned_sub_items)': { _eq: 1 } });
	});

	it('leaves a field no relation describes alone', () => {
		expect(expand({ nonexistent: { _eq: 1 } }))
			.toEqual({ nonexistent: { _eq: 1 } });
	});

	it('never mutates the filter it is given', () => {
		const original = { owned_sub_items: { _gt: 7 } };

		expand(original);

		expect(original).toEqual({ owned_sub_items: { _gt: 7 } });
	});
});
