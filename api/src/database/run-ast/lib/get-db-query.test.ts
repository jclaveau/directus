import { SchemaBuilder } from '@directus/schema-builder';
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
		+ ' left join "users" as "alias_1"'
		+ ' on "articles"."author" = "alias_1"."id"'
		+ ' left join "companies" as "alias_2"'
		+ ' on "alias_1"."company" = "alias_2"."id"'
		+ ' where "alias_2"."name" = ? limit ?',
	);

	expect(query.bindings).toEqual(['acme', 10]);
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
		+ ' inner join (select distinct "articles"."id" from "articles"'
		+ ' left join "users" as "alias_1"'
		+ ' on "articles"."author" = "alias_1"."id"'
		+ ' left join "links_list" as "alias_2"'
		+ ' on "articles"."id" = "alias_2"."article_id"'
		+ ' where ("alias_1"."name" = ? and "articles"."id" in'
		+ ' (select "links_list"."article_id" as "article_id"'
		+ ' from "links_list" left join "users" as "alias_4"'
		+ ' on "links_list"."owner" = "alias_4"."id"'
		+ ' where "links_list"."article_id" is not null'
		+ ' and "alias_4"."name" = ?)) limit ?) as "inner"'
		+ ' on "articles"."id" = "inner"."id"',
	);

	expect(query.bindings).toEqual(['ann', 'bob', 10]);
});
