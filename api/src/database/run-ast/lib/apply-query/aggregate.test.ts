import { SchemaBuilder } from '@directus/schema-builder';
import type { Permission } from '@directus/types';
import knex from 'knex';
import { expect, test } from 'vitest';
import { applyAggregate } from './aggregate.js';
import { createAliasGenerator } from './create-alias-generator.js';
import { Client_SQLite3 } from './mock.js';

const schema = new SchemaBuilder()
	.collection('articles', (c) => {
		c.field('id').id();
		c.field('author').m2o('users');
	})
	.build();

test('a field one rule grants is summed through that rule', () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{ sum: ['salary'] },
		'articles',
		false,
		{
			knex: db,
			cases: [{}, { id: { _gt: 5 } }],
			permissions: [
				{
					collection: 'articles',
					permissions: {},
					fields: ['id'],
				},
				{
					collection: 'articles',
					permissions: { id: { _gt: 5 } },
					fields: ['salary'],
				},
			] as Permission[],
			generateAlias: createAliasGenerator(),
		},
	);

	const rawQuery = queryBuilder.toSQL();

	expect(rawQuery.sql).toEqual(
		'select sum((CASE WHEN "articles"."id" in'
		+ ' (select distinct "articles"."id" from "articles"'
		+ ' where ("articles"."id" > ?))'
		+ ' THEN "articles"."salary" END)) as "sum->salary"',
	);

	expect(rawQuery.bindings).toEqual([5]);
});

test.each([
	['count', 'count('],
	['countDistinct', 'count(distinct '],
	['avg', 'avg('],
	['avgDistinct', 'avg(distinct '],
	['sum', 'sum('],
	['sumDistinct', 'sum(distinct '],
	['min', 'min('],
	['max', 'max('],
])('%s of a field one rule grants goes through that rule', (operation, sqlStart) => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{ [operation]: ['salary'] },
		'articles',
		false,
		{
			knex: db,
			cases: [{}, { id: { _gt: 5 } }],
			permissions: [
				{
					collection: 'articles',
					permissions: {},
					fields: ['id'],
				},
				{
					collection: 'articles',
					permissions: { id: { _gt: 5 } },
					fields: ['salary'],
				},
			] as Permission[],
			generateAlias: createAliasGenerator(),
		},
	);

	expect(queryBuilder.toSQL().sql).toEqual(
		`select ${sqlStart}(CASE WHEN "articles"."id" in`
		+ ' (select distinct "articles"."id" from "articles"'
		+ ' where ("articles"."id" > ?))'
		+ ` THEN "articles"."salary" END)) as "${operation}->salary"`,
	);

	expect(queryBuilder.toSQL().bindings).toEqual([5]);
});

test('an operation named after an object key selects nothing', () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		JSON.parse('{"constructor":["salary"]}'),
		'articles',
		false,
		{
			knex: db,
			cases: [{}, { id: { _gt: 5 } }],
			permissions: [
				{
					collection: 'articles',
					permissions: {},
					fields: ['id'],
				},
				{
					collection: 'articles',
					permissions: { id: { _gt: 5 } },
					fields: ['salary'],
				},
			] as Permission[],
			generateAlias: createAliasGenerator(),
		},
	);

	expect(queryBuilder.toSQL().sql).toEqual('select *');
});

test('countDistinct of a primary key one rule grants counts every row read', () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{ countDistinct: ['id'] },
		'articles',
		false,
		{
			knex: db,
			cases: [{}, { id: { _gt: 5 } }],
			permissions: [
				{
					collection: 'articles',
					permissions: {},
					fields: ['salary'],
				},
				{
					collection: 'articles',
					permissions: { id: { _gt: 5 } },
					fields: ['id'],
				},
			] as Permission[],
			generateAlias: createAliasGenerator(),
		},
	);

	expect(queryBuilder.toSQL().sql).toEqual(
		'select count("articles"."id") as "countDistinct->id"',
	);

	expect(queryBuilder.toSQL().bindings).toEqual([]);
});

test('countDistinct of a granted primary key stays distinct over a join', () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{ countDistinct: ['id'] },
		'articles',
		true,
		{
			knex: db,
			cases: [{}, { id: { _gt: 5 } }],
			permissions: [
				{
					collection: 'articles',
					permissions: {},
					fields: ['salary'],
				},
				{
					collection: 'articles',
					permissions: { id: { _gt: 5 } },
					fields: ['id'],
				},
			] as Permission[],
			generateAlias: createAliasGenerator(),
		},
	);

	expect(queryBuilder.toSQL().sql).toEqual(
		'select count(distinct "articles"."id") as "countDistinct->id"',
	);

	expect(queryBuilder.toSQL().bindings).toEqual([]);
});

test('count of a primary key one rule grants counts every row read', () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{ count: ['id'] },
		'articles',
		false,
		{
			knex: db,
			cases: [{}, { id: { _gt: 5 } }],
			permissions: [
				{
					collection: 'articles',
					permissions: {},
					fields: ['salary'],
				},
				{
					collection: 'articles',
					permissions: { id: { _gt: 5 } },
					fields: ['id'],
				},
			] as Permission[],
			generateAlias: createAliasGenerator(),
		},
	);

	expect(queryBuilder.toSQL().sql).toEqual(
		'select count("articles"."id") as "count->id"',
	);

	expect(queryBuilder.toSQL().bindings).toEqual([]);
});

test('min of a primary key one rule grants goes through that rule', () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{ min: ['id'] },
		'articles',
		false,
		{
			knex: db,
			cases: [{}, { id: { _gt: 5 } }],
			permissions: [
				{
					collection: 'articles',
					permissions: {},
					fields: ['salary'],
				},
				{
					collection: 'articles',
					permissions: { id: { _gt: 5 } },
					fields: ['id'],
				},
			] as Permission[],
			generateAlias: createAliasGenerator(),
		},
	);

	expect(queryBuilder.toSQL().sql).toEqual(
		'select min((CASE WHEN "articles"."id" in'
		+ ' (select distinct "articles"."id" from "articles"'
		+ ' where ("articles"."id" > ?))'
		+ ' THEN "articles"."id" END)) as "min->id"',
	);

	expect(queryBuilder.toSQL().bindings).toEqual([5]);
});

test('a field granted on every row reads no case', () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{ sum: ['salary'] },
		'articles',
		false,
		{
			knex: db,
			cases: [{}, { id: { _gt: 5 } }],
			permissions: [
				{
					collection: 'articles',
					permissions: {},
					fields: ['salary'],
				},
				{
					collection: 'articles',
					permissions: { id: { _gt: 5 } },
					fields: ['id'],
				},
			] as Permission[],
			generateAlias: createAliasGenerator(),
		},
	);

	expect(queryBuilder.toSQL().sql).toEqual(
		'select sum("articles"."salary") as "sum->salary"',
	);
});

test('a field granted by every rule the rows go through reads no case', () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{ sum: ['salary'] },
		'articles',
		false,
		{
			knex: db,
			cases: [{ id: { _gt: 5 } }],
			permissions: [
				{
					collection: 'articles',
					permissions: { id: { _gt: 5 } },
					fields: ['*'],
				},
				{
					collection: 'articles',
					permissions: { id: { _lt: 2 } },
					fields: ['salary'],
				},
			] as unknown as Permission[],
			generateAlias: createAliasGenerator(),
		},
	);

	expect(queryBuilder.toSQL().sql).toEqual(
		'select sum("articles"."salary") as "sum->salary"',
	);
});

test('a field granted by a rule the rows do not go through reads a case', () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{ sum: ['salary'] },
		'articles',
		false,
		{
			knex: db,
			cases: [{ id: { _lt: 2 } }],
			permissions: [
				{
					collection: 'articles',
					permissions: { id: { _lt: 2 } },
					fields: ['category'],
				},
				{
					collection: 'articles',
					permissions: { id: { _gt: 5 } },
					fields: ['salary'],
				},
			] as unknown as Permission[],
			generateAlias: createAliasGenerator(),
		},
	);

	expect(queryBuilder.toSQL().sql).toEqual(
		'select sum((CASE WHEN "articles"."id" in'
		+ ' (select distinct "articles"."id" from "articles"'
		+ ' where ("articles"."id" > ?))'
		+ ' THEN "articles"."salary" END)) as "sum->salary"',
	);

	expect(queryBuilder.toSQL().bindings).toEqual([5]);
});

test('a count of every row reads no case', () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{ count: ['*'], countAll: ['*'] },
		'articles',
		false,
		{
			knex: db,
			cases: [{}, { id: { _gt: 5 } }],
			permissions: [
				{
					collection: 'articles',
					permissions: {},
					fields: ['id'],
				},
				{
					collection: 'articles',
					permissions: { id: { _gt: 5 } },
					fields: ['salary'],
				},
			] as Permission[],
			generateAlias: createAliasGenerator(),
		},
	);

	expect(queryBuilder.toSQL().sql).toEqual(
		'select count(*) as "count", count(*) as "countAll"',
	);
});

test('an admin has no permission and reads no case', () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{ sum: ['salary'] },
		'articles',
		false,
		{
			knex: db,
			cases: [],
			permissions: [],
			generateAlias: createAliasGenerator(),
		},
	);

	expect(queryBuilder.toSQL().sql).toEqual(
		'select sum("articles"."salary") as "sum->salary"',
	);
});

test('a read with no case still reads the rule of the field', () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{ sum: ['salary'] },
		'articles',
		false,
		{
			knex: db,
			cases: [],
			permissions: [
				{
					collection: 'articles',
					permissions: { id: { _gt: 5 } },
					fields: ['salary'],
				},
			] as unknown as Permission[],
			generateAlias: createAliasGenerator(),
		},
	);

	expect(queryBuilder.toSQL().sql).toEqual(
		'select sum((CASE WHEN "articles"."id" in'
		+ ' (select distinct "articles"."id" from "articles"'
		+ ' where ("articles"."id" > ?))'
		+ ' THEN "articles"."salary" END)) as "sum->salary"',
	);
});

test('a rule granting every field on every row reads no case', () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{ sum: ['salary'] },
		'articles',
		false,
		{
			knex: db,
			cases: [{}, { id: { _gt: 5 } }],
			permissions: [
				{
					collection: 'articles',
					permissions: {},
					fields: ['*'],
				},
				{
					collection: 'articles',
					permissions: { id: { _gt: 5 } },
					fields: ['salary'],
				},
			] as unknown as Permission[],
			generateAlias: createAliasGenerator(),
		},
	);

	expect(queryBuilder.toSQL().sql).toEqual(
		'select sum("articles"."salary") as "sum->salary"',
	);
});

test('aggregate empty', async () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(schema, queryBuilder, {}, 'articles', true);

	const rawQuery = queryBuilder.toSQL();

	expect(rawQuery.sql).toEqual(`select *`);
	expect(rawQuery.bindings).toEqual([]);
});

test('aggregate counting id and title', async () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{
			count: ['id', 'title'],
		},
		'articles',
		true,
	);

	const rawQuery = queryBuilder.toSQL();

	expect(rawQuery.sql).toEqual(
		`select count("articles"."id") as "count->id", count("articles"."title") as "count->title"`,
	);

	expect(rawQuery.bindings).toEqual([]);
});

test('aggregate counting *', async () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{
			count: ['*'],
		},
		'articles',
		true,
	);

	const rawQuery = queryBuilder.toSQL();

	expect(rawQuery.sql).toEqual(`select count(*) as "count"`);
	expect(rawQuery.bindings).toEqual([]);
});

test('aggregate countDistinct title', async () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{
			countDistinct: ['title'],
		},
		'articles',
		false,
	);

	const rawQuery = queryBuilder.toSQL();

	expect(rawQuery.sql).toEqual(`select count(distinct "articles"."title") as "countDistinct->title"`);
	expect(rawQuery.bindings).toEqual([]);
});

test('aggregate countDistinct id as it is unique', async () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{
			countDistinct: ['id'],
		},
		'articles',
		false,
	);

	const rawQuery = queryBuilder.toSQL();

	expect(rawQuery.sql).toEqual(`select count("articles"."id") as "countDistinct->id"`);
	expect(rawQuery.bindings).toEqual([]);
});

test('aggregate countAll', async () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{
			countAll: ['*'],
		},
		'articles',
		false,
	);

	const rawQuery = queryBuilder.toSQL();

	expect(rawQuery.sql).toEqual(`select count(*) as "countAll"`);
	expect(rawQuery.bindings).toEqual([]);
});

test('aggregate count o2m', async () => {
	const o2mSchema = new SchemaBuilder()
		.collection('articles', (c) => {
			c.field('id').id();
			c.field('title').string();
			c.field('links').o2m('link_list', 'article_id');
		})
		.build();

	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		o2mSchema,
		queryBuilder,
		{
			count: ['links'],
		},
		'articles',
		false,
	);

	const rawQuery = queryBuilder.toSQL();

	expect(rawQuery.sql).toEqual(`select count("articles"."links") as "count->links"`);
	expect(rawQuery.bindings).toEqual([]);
});

test('a distinct count of every field takes no case', async () => {
	const db = knex.default({ client: Client_SQLite3 });
	const queryBuilder = db.queryBuilder();

	applyAggregate(
		schema,
		queryBuilder,
		{ countDistinct: ['*'] },
		'articles',
		false,
		{
			knex: db,
			cases: [{ id: { _gt: 5 } }, { id: { _lt: 2 } }],
			permissions: [
				{
					collection: 'articles',
					permissions: { id: { _gt: 5 } },
					fields: ['*'],
				},
				{
					collection: 'articles',
					permissions: { id: { _lt: 2 } },
					fields: ['id'],
				},
			] as unknown as Permission[],
			generateAlias: createAliasGenerator(),
		},
	);

	const rawQuery = queryBuilder.toSQL();

	expect(rawQuery.sql).toEqual(
		'select count(distinct "articles".*) as "countDistinct->*"',
	);

	expect(rawQuery.bindings).toEqual([]);
});
