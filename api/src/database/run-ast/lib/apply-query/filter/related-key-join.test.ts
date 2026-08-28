import { SchemaBuilder } from '@directus/schema-builder';
import knex from 'knex';
import { describe, expect, test, vi } from 'vitest';
import { Client_SQLite3 } from '../mock.js';

/**
 * A filter whose terminal segment is the RELATED collection's primary key joins
 * that collection and matches one row of it — never the local foreign key
 * column, and never a wider set.
 *
 * The scoped cache reads exactly this to pin such a collection by
 * `<collection>:<pk>=<key>` instead of tagging it bare
 * (`scopedCacheFilterKeyingByCollection`). If any of these ever compiled to
 * something wider, that pin would start serving stale reads, so the SQL is
 * asserted here rather than assumed.
 */

const aliasFn = vi.fn();
let aliasCounter = 0;

vi.doMock('nanoid/non-secure', () => {
	return { customAlphabet: () => aliasFn };
});

const { applyFilter } = await import('./index.js');

const schema = new SchemaBuilder()
	.collection('owner', (c) => {
		c.field('id').id();
		c.field('name').string();
	})
	.collection('owned_item', (c) => {
		c.field('id').id();
		c.field('owner').m2o('owner');
		c.field('owned_sub_items').o2m('owned_sub_item', 'owned_item');
		c.field('categories').m2m('category');
	})
	.collection('owned_sub_item', (c) => {
		c.field('id').id();
		c.field('owned_item').m2o('owned_item');
	})
	.collection('category', (c) => {
		c.field('id').id();
	})
	.build();

function compile(filter: any) {
	aliasCounter = 0;
	aliasFn.mockImplementation(() => `a${++aliasCounter}`);

	const db = vi.mocked(knex.default({ client: Client_SQLite3 }));
	const queryBuilder = db.queryBuilder();

	applyFilter(db, schema, queryBuilder, filter, 'owned_item', {}, [], []);

	// Only the query, not `toSQL()`'s per-call `__knexQueryUid`, so two
	// spellings of one query can be compared for equality.
	const { sql, bindings } = queryBuilder.toSQL();

	return { sql, bindings };
}

describe('a filter terminating on a related primary key', () => {
	test('joins the related collection and matches the one row named', () => {
		expect(compile({ owner: { id: { _eq: 7 } } })).toMatchObject({
			sql: 'select * left join "owner" as "a1" '
				+ 'on "owned_item"."owner" = "a1"."id" where "a1"."id" = ?',
			bindings: [7],
		});
	});

	test('matches exactly the rows an `_in` lists', () => {
		expect(compile({ owner: { id: { _in: [7, 8] } } })).toMatchObject({
			sql: 'select * left join "owner" as "a1" '
				+ 'on "owned_item"."owner" = "a1"."id" where "a1"."id" in (?, ?)',
			bindings: [7, 8],
		});
	});

	test('joins a to-many relation the same way', () => {
		expect(compile({ owned_sub_items: { id: { _eq: 7 } } })).toMatchObject({
			sql: 'select * left join "owned_sub_item" as "a1" '
				+ 'on "owned_item"."id" = "a1"."owned_item" where "a1"."id" = ?',
			bindings: [7],
		});
	});

	test('compiles every to-many spelling to one identical query', () => {
		// `getOperation` reads a bare leaf as `_eq`, and `getColumnPath` appends
		// the related primary key to a top-level alias field, so these four are
		// one query. The scope analysis has to reach one answer for all of them.
		const longhand = compile({ owned_sub_items: { id: { _eq: 7 } } });

		for (const filter of [
			{ owned_sub_items: { id: 7 } },
			{ owned_sub_items: { _eq: 7 } },
			{ owned_sub_items: 7 },
		]) {
			expect(compile(filter)).toEqual(longhand);
		}
	});

	test('appends the junction key for an M2M spelled on the alias', () => {
		expect(compile({ categories: { _eq: 7 } })).toMatchObject({
			sql: 'select * left join "owned_item_category_junction" as "a1" '
				+ 'on "owned_item"."id" = "a1"."owned_item_id" '
				+ 'where "a1"."id" = ?',
			bindings: [7],
		});
	});

	test('reaches the same one row through `_some`', () => {
		expect(compile({ owned_sub_items: { _some: { id: { _eq: 7 } } } }))
			.toMatchObject({
				sql: 'select * left join "owned_sub_item" as "a1" '
					+ 'on "owned_item"."id" = "a1"."owned_item" '
					+ 'where "owned_item"."id" in ('
					+ 'select "owned_sub_item"."owned_item" as "owned_item" '
					+ 'from "owned_sub_item" '
					+ 'where "owned_sub_item"."owned_item" is not null '
					+ 'and "owned_sub_item"."id" = ?)',
				bindings: [7],
			});
	});

	test('negates over the same one row through `_none`', () => {
		expect(compile({ owned_sub_items: { _none: { id: { _eq: 7 } } } }))
			.toMatchObject({
				sql: 'select * left join "owned_sub_item" as "a1" '
					+ 'on "owned_item"."id" = "a1"."owned_item" '
					+ 'where "owned_item"."id" not in ('
					+ 'select "owned_sub_item"."owned_item" as "owned_item" '
					+ 'from "owned_sub_item" '
					+ 'where "owned_sub_item"."owned_item" is not null '
					+ 'and "owned_sub_item"."id" = ?)',
				bindings: [7],
			});
	});

	test('crosses an M2M junction to key the far collection', () => {
		expect(compile({ categories: { category_id: { id: { _eq: 7 } } } }))
			.toMatchObject({
				sql: 'select * '
					+ 'left join "owned_item_category_junction" as "a1" '
					+ 'on "owned_item"."id" = "a1"."owned_item_id" '
					+ 'left join "category" as "a2" '
					+ 'on "a1"."category_id" = "a2"."id" where "a2"."id" = ?',
				bindings: [7],
			});
	});

	test('gives each path to one collection its own join', () => {
		// Two aliases means two independent rows, which is why a second,
		// unkeyed path to a collection has to take its pin down.
		expect(compile({
			_and: [
				{ owner: { id: { _eq: 7 } } },
				{ owned_sub_items: { owned_item: { owner: { name: { _eq: 'x' } } } } },
			],
		}).sql).toContain('left join "owner" as "a4"');
	});

	test('gives sibling conditions on one path a single shared join', () => {
		// One alias means one row, which is why a key named anywhere on a path
		// still pins it however the siblings read it.
		const { sql } = compile({
			_and: [
				{ owner: { id: { _eq: 7 } } },
				{ owner: { name: { _eq: 'alice' } } },
			],
		});

		expect(sql).toBe(
			'select * left join "owner" as "a1" on "owned_item"."owner" = "a1"."id" '
			+ 'where ("a1"."id" = ? and "a1"."name" = ?)',
		);
	});
});

describe('a filter that does NOT terminate on a related primary key', () => {
	test('compares the foreign key in place, joining nothing', () => {
		// No join, so the read depends on no row of `owner` at all.
		expect(compile({ owner: { _eq: 7 } })).toMatchObject({
			sql: 'select * where "owned_item"."owner" = ?',
			bindings: [7],
		});
	});

	test('compares the foreign key in place for an M2O bare value too', () => {
		// The mirror of the to-many spellings: here the column is local, so the
		// related collection is never read whichever way it is written.
		expect(compile({ owner: 7 })).toEqual(compile({ owner: { _eq: 7 } }));

		expect(compile({ owner: 7 })).toMatchObject({
			sql: 'select * where "owned_item"."owner" = ?',
			bindings: [7],
		});
	});

	test('joins on a non-key column, which any row can come to match', () => {
		expect(compile({ owner: { name: { _eq: 'alice' } } })).toMatchObject({
			sql: 'select * left join "owner" as "a1" '
				+ 'on "owned_item"."owner" = "a1"."id" where "a1"."name" = ?',
			bindings: ['alice'],
		});
	});

	test('drops a `_not` entirely, compiling no condition at all', () => {
		// Upstream `applyFilter` has no `_not` branch: `getFilterPath` stops at
		// the operator and the clause is skipped.
		expect(compile({ _not: { owner: { id: { _eq: 7 } } } })).toMatchObject({
			sql: 'select *',
			bindings: [],
		});
	});
});
