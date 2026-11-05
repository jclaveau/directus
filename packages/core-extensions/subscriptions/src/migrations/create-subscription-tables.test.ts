import knex from 'knex';
import { describe, expect, test } from 'vitest';
import { createSubscriptionTables } from './create-subscription-tables.js';

describe('createSubscriptionTables', () => {
	test('creates the subscription tables, then drops them', async () => {
		const database = knex({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
			pool: { min: 1, max: 1 },
		});

		await createSubscriptionTables.config.up(database);

		expect(await database('sqlite_master')
			.where('type', 'table')
			.orderBy('name')
			.pluck('name'))
			.toEqual([
				'sqlite_sequence',
				'subscriber_customers',
				'subscribers',
				'subscription_plan_references',
				'subscription_plans',
				'subscription_sync_queue',
				'subscriptions',
			]);

		await createSubscriptionTables.config.down(database);

		expect(await database('sqlite_master')
			.where('type', 'table')
			.orderBy('name')
			.pluck('name'))
			.toEqual(['sqlite_sequence']);

		await database.destroy();
	});

	test('runs before Directus reads the schema', () => {
		expect(createSubscriptionTables.config.phase).toBe('before-schema');
	});
});
