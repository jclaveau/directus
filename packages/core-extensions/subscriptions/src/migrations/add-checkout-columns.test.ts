import knex from 'knex';
import { describe, expect, test } from 'vitest';
import { addCheckoutColumns } from './add-checkout-columns.js';
import { createSubscriptionTables } from './create-subscription-tables.js';

describe('addCheckoutColumns', () => {
	test('adds the checkout columns, then drops them', async () => {
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

		await createSubscriptionTables.config.up(database);
		await addCheckoutColumns.config.up(database);

		expect(Object.keys(await database('subscriptions').columnInfo()))
			.toEqual([
				'id',
				'plan',
				'continues',
				'provider',
				'provider_customer_id',
				'provider_subscription_id',
				'status',
				'current_period_end',
				'cancel_at_period_end',
				'user_updated',
				'date_created',
				'date_updated',
				'payer',
				'custom_amount',
				'billing_mismatch',
			]);

		await addCheckoutColumns.config.down(database);

		expect(Object.keys(await database('subscriptions').columnInfo()))
			.toEqual([
				'id',
				'plan',
				'continues',
				'provider',
				'provider_customer_id',
				'provider_subscription_id',
				'status',
				'current_period_end',
				'cancel_at_period_end',
				'user_updated',
				'date_created',
				'date_updated',
			]);

		await database.destroy();
	});
});
