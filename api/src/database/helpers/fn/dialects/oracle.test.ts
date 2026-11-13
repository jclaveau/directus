import { SchemaBuilder } from '@directus/schema-builder';
import knex from 'knex';
import { expect, test } from 'vitest';
import { Client_SQLite3 } from '../../../run-ast/lib/apply-query/mock.js';
import { oracle as FnHelperOracle } from '../index.js';

test('count of a relational field aliases its subquery from the generator', () => {
	const rawQuery = new FnHelperOracle(
		knex.default({ client: Client_SQLite3 }),
		new SchemaBuilder()
			.collection('articles', (collection) => {
				collection.field('id').id();
				collection.field('links').o2m('links', 'article_id');
			})
			.build(),
	).count('articles', 'links', {
		type: undefined,
		originalCollectionName: undefined,
		relationalCountOptions: undefined,
		generateAlias: () => '__alias_7',
	})
		.toSQL();

	expect(rawQuery.sql).toEqual(
		'(select count(*) from "links" as "__alias_7"'
		+ ' where "__alias_7"."article_id" = "articles"."id")',
	);

	expect(rawQuery.bindings).toEqual([]);
});
