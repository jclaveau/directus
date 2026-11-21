import knex from 'knex';
import { describe, expect, test } from 'vitest';
import { createInvitesTable } from './create-invites-table.js';

describe('createInvitesTable', () => {
	test('creates the invites table, then drops it', async () => {
		const database = knex({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
			pool: { min: 1, max: 1 },
		});

		await database.schema.createTable('directus_users', (table) => {
			table.uuid('id')
				.primary();
		});

		await createInvitesTable.config.up(database);

		expect(Object.keys(await database('subscription_invites').columnInfo()))
			.toEqual(['id', 'user', 'date_sent']);

		await createInvitesTable.config.down(database);

		expect(await database.schema.hasTable('subscription_invites'))
			.toBe(false);

		await database.destroy();
	});
});
