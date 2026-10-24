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

	// The full SQL carries random join and sort aliases, the window alias does not
	expect(sql).toContain(') as directus_row_number from');
});
