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
				'subscription_beneficiaries',
				'subscription_events',
				'subscription_managers',
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

	test('indexes every foreign key column', async () => {
		const database = knex({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
			pool: { min: 1, max: 1 },
		});

		await createSubscriptionTables.config.up(database);

		expect(await database('sqlite_master')
			.where('type', 'index')
			.orderBy('name')
			.pluck('name'))
			.toEqual([
				'subscription_beneficiaries_access_index',
				'subscription_beneficiaries_subscription_user_unique',
				'subscription_beneficiaries_user_index',
				'subscription_events_subscription_index',
				'subscription_managers_subscription_user_unique',
				'subscription_managers_user_index',
				'subscription_plans_code_unique',
				'subscription_plans_policy_index',
				'subscription_sync_queue_pending_next_attempt_at_index',
				'subscription_sync_queue_provider_resource_id_unique',
				'subscriptions_continues_unique',
				'subscriptions_plan_index',
				'subscriptions_provider_provider_subscription_id_unique',
				'subscriptions_user_updated_index',
			]);

		await database.destroy();
	});

	test('runs before Directus reads the schema', () => {
		expect(createSubscriptionTables.config.phase).toBe('before-schema');
	});
});
