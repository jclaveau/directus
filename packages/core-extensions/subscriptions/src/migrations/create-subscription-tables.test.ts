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
				'subscription_events',
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
				'subscriber_customers_provider_provider_customer_id_unique',
				'subscriber_customers_subscriber_index',
				'subscribers_user_unique',
				'subscription_events_subscription_index',
				'subscription_plan_references_plan_index',
				'subscription_plan_references_provider_reference_unique',
				'subscription_plans_code_unique',
				'subscription_plans_policy_index',
				'subscription_sync_queue_pending_next_attempt_at_index',
				'subscription_sync_queue_provider_resource_id_unique',
				'subscriptions_access_index',
				'subscriptions_customer_index',
				'subscriptions_plan_reference_index',
				'subscriptions_provider_provider_subscription_id_unique',
				'subscriptions_resumes_index',
				'subscriptions_subscriber_index',
				'subscriptions_user_updated_index',
			]);

		await database.destroy();
	});

	test('runs before Directus reads the schema', () => {
		expect(createSubscriptionTables.config.phase).toBe('before-schema');
	});
});
