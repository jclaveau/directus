import { SchemaBuilder } from '@directus/schema-builder';
import type { Permission } from '@directus/types';
import knex from 'knex';
import { expect, test, vi } from 'vitest';
import { Client_SQLite3 } from './apply-query/mock.js';
import { getDBQuery } from './get-db-query.js';

vi.mock('@directus/env', () => ({ useEnv: () => ({}) }));

test('a multi-relational sort aliases the row number once', () => {
	const sql = getDBQuery(
		{
			table: 'articles',
			fieldNodes: [
				{
					type: 'field',
					name: 'id',
					fieldKey: 'id',
					alias: false,
					whenCase: [],
				},
			],
			o2mNodes: [],
			query: { sort: ['links.id'], limit: 10 },
			cases: [],
			permissions: [],
		},
		{
			knex: knex.default({ client: Client_SQLite3 }),
			schema: new SchemaBuilder()
				.collection('articles', (c) => {
					c.field('id').id();
					c.field('links').o2m('link_list', 'article_id');
				})
				.build(),
		},
	).toSQL().sql;

	// The window alias is never numbered like the join and sort aliases
	expect(sql).toContain(') as "directus_row_number" from');
});

test('two joins of one statement get distinct aliases', () => {
	const query = getDBQuery(
		{
			table: 'articles',
			fieldNodes: [
				{
					type: 'field',
					name: 'id',
					fieldKey: 'id',
					alias: false,
					whenCase: [],
				},
			],
			o2mNodes: [],
			query: {
				filter: { author: { company: { name: { _eq: 'acme' } } } },
				limit: 10,
			},
			cases: [],
			permissions: [],
		},
		{
			knex: knex.default({ client: Client_SQLite3 }),
			schema: new SchemaBuilder()
				.collection('articles', (c) => {
					c.field('id').id();
					c.field('author').m2o('users');
				})
				.collection('users', (c) => {
					c.field('id').id();
					c.field('company').m2o('companies');
				})
				.collection('companies', (c) => {
					c.field('id').id();
					c.field('name').string();
				})
				.build(),
		},
	).toSQL();

	expect(query.sql).toEqual(
		'select "articles"."id" from "articles"'
		+ ' left join "users" as "__alias_1"'
		+ ' on "articles"."author" = "__alias_1"."id"'
		+ ' left join "companies" as "__alias_2"'
		+ ' on "__alias_1"."company" = "__alias_2"."id"'
		+ ' where "__alias_2"."name" = ? limit ?',
	);

	expect(query.bindings).toEqual(['acme', 10]);
});

test('a join alias never takes the name of a collection', () => {
	const query = getDBQuery(
		{
			table: 'alias_1',
			fieldNodes: [
				{
					type: 'field',
					name: 'id',
					fieldKey: 'id',
					alias: false,
					whenCase: [],
				},
			],
			o2mNodes: [],
			query: {
				filter: { author: { name: { _eq: 'Rijk' } } },
				limit: 10,
			},
			cases: [],
			permissions: [],
		},
		{
			knex: knex.default({ client: Client_SQLite3 }),
			schema: new SchemaBuilder()
				.collection('alias_1', (collection) => {
					collection.field('id').id();
					collection.field('author').m2o('users');
				})
				.collection('users', (collection) => {
					collection.field('id').id();
					collection.field('name').string();
				})
				.build(),
		},
	).toSQL();

	expect(query.sql).toEqual(
		'select "alias_1"."id" from "alias_1"'
		+ ' left join "users" as "__alias_1"'
		+ ' on "alias_1"."author" = "__alias_1"."id"'
		+ ' where "__alias_1"."name" = ? limit ?',
	);

	expect(query.bindings).toEqual(['Rijk', 10]);
});

test('a join inside a _some subquery continues the numbering', () => {
	const query = getDBQuery(
		{
			table: 'articles',
			fieldNodes: [
				{
					type: 'field',
					name: 'id',
					fieldKey: 'id',
					alias: false,
					whenCase: [],
				},
			],
			o2mNodes: [],
			query: {
				filter: {
					author: { name: { _eq: 'ann' } },
					links: { _some: { owner: { name: { _eq: 'bob' } } } },
				},
				limit: 10,
			},
			cases: [],
			permissions: [],
		},
		{
			knex: knex.default({ client: Client_SQLite3 }),
			schema: new SchemaBuilder()
				.collection('articles', (c) => {
					c.field('id').id();
					c.field('author').m2o('users');
					c.field('links').o2m('links_list', 'article_id');
				})
				.collection('links_list', (c) => {
					c.field('id').id();
					c.field('owner').m2o('users');
				})
				.collection('users', (c) => {
					c.field('id').id();
					c.field('name').string();
				})
				.build(),
		},
	).toSQL();

	expect(query.sql).toEqual(
		'select "articles"."id" from "articles"'
		+ ' left join "users" as "__alias_1"'
		+ ' on "articles"."author" = "__alias_1"."id"'
		+ ' where ("__alias_1"."name" = ? and "articles"."id" in'
		+ ' (select "links_list"."article_id" as "article_id"'
		+ ' from "links_list" left join "users" as "__alias_2"'
		+ ' on "links_list"."owner" = "__alias_2"."id"'
		+ ' where "links_list"."article_id" is not null'
		+ ' and "__alias_2"."name" = ?)) limit ?',
	);

	expect(query.bindings).toEqual(['ann', 'bob', 10]);
});

test('a count filtered through an o2m reads each parent key once', () => {
	const query = getDBQuery(
		{
			table: 'articles',
			fieldNodes: [],
			o2mNodes: [],
			query: {
				aggregate: { count: ['*'] },
				filter: { links: { name: { _eq: 'im' } } },
				limit: 10,
			},
			cases: [],
			permissions: [],
		},
		{
			knex: knex.default({ client: Client_SQLite3 }),
			schema: new SchemaBuilder()
				.collection('articles', (c) => {
					c.field('id').id();
					c.field('links').o2m('links_list', 'article_id');
				})
				.collection('links_list', (c) => {
					c.field('id').id();
					c.field('name').string();
				})
				.build(),
		},
	).toSQL();

	expect(query.sql).toEqual(
		'select count(*) as "count" from "articles"'
		+ ' where "articles"."id" in'
		+ ' (select distinct "articles"."id" from "articles"'
		+ ' left join "links_list" as "__alias_1"'
		+ ' on "articles"."id" = "__alias_1"."article_id"'
		+ ' where "__alias_1"."name" = ?) limit ?',
	);

	expect(query.bindings).toEqual(['im', 10]);
});

test('a grouped case through an o2m reads the keys it matches', () => {
	const query = getDBQuery(
		{
			table: 'articles',
			fieldNodes: [
				{
					type: 'field',
					name: 'category',
					fieldKey: 'category',
					alias: false,
					whenCase: [0],
				},
			],
			o2mNodes: [],
			query: {
				aggregate: { count: ['*'] },
				group: ['category'],
				limit: 10,
			},
			cases: [{ links: { name: { _eq: 'im' } } }],
			permissions: [],
		},
		{
			knex: knex.default({ client: Client_SQLite3 }),
			schema: new SchemaBuilder()
				.collection('articles', (c) => {
					c.field('id').id();
					c.field('category').string();
					c.field('links').o2m('links_list', 'article_id');
				})
				.collection('links_list', (c) => {
					c.field('id').id();
					c.field('name').string();
				})
				.build(),
		},
	).toSQL();

	expect(query.sql).toEqual(
		'select count(*) as "count",'
		+ ' (CASE WHEN "articles"."id" in'
		+ ' (select distinct "articles"."id" from "articles"'
		+ ' left join "links_list" as "__alias_3"'
		+ ' on "articles"."id" = "__alias_3"."article_id"'
		+ ' where ("__alias_3"."name" = ?))'
		+ ' THEN "articles"."category" END) AS "category"'
		+ ' from "articles"'
		+ ' where "articles"."id" in'
		+ ' (select distinct "articles"."id" from "articles"'
		+ ' left join "links_list" as "__alias_1"'
		+ ' on "articles"."id" = "__alias_1"."article_id"'
		+ ' where ("__alias_1"."name" = ?))'
		+ ' group by (CASE WHEN "articles"."id" in'
		+ ' (select distinct "articles"."id" from "articles"'
		+ ' left join "links_list" as "__alias_2"'
		+ ' on "articles"."id" = "__alias_2"."article_id"'
		+ ' where ("__alias_2"."name" = ?))'
		+ ' THEN "articles"."category" END) limit ?',
	);

	expect(query.bindings).toEqual(['im', 'im', 'im', 10]);
});

test('an aggregate reads a field through the rule granting it', () => {
	const query = getDBQuery(
		{
			table: 'articles',
			fieldNodes: [],
			o2mNodes: [],
			query: {
				aggregate: { sum: ['salary'] },
				limit: 10,
			},
			cases: [{ id: { _lt: 2 } }, { id: { _gt: 5 } }],
			permissions: [
				{
					collection: 'articles',
					permissions: { id: { _lt: 2 } },
					fields: ['id'],
				},
				{
					collection: 'articles',
					permissions: { id: { _gt: 5 } },
					fields: ['salary'],
				},
			] as unknown as Permission[],
		},
		{
			knex: knex.default({ client: Client_SQLite3 }),
			schema: new SchemaBuilder()
				.collection('articles', (c) => {
					c.field('id').id();
					c.field('salary').integer();
				})
				.build(),
		},
	).toSQL();

	expect(query.sql).toEqual(
		'select sum((CASE WHEN "articles"."id" in'
		+ ' (select distinct "articles"."id" from "articles"'
		+ ' where ("articles"."id" > ?))'
		+ ' THEN "articles"."salary" END)) as "sum->salary"'
		+ ' from "articles"'
		+ ' where ("articles"."id" < ? or "articles"."id" > ?) limit ?',
	);

	expect(query.bindings).toEqual([5, 2, 5, 10]);
});
