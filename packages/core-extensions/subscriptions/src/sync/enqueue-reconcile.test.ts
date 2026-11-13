import type { MollieClient } from '@mollie/api-client';
import knex, { type Knex } from 'knex';
import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import { createMollieProvider } from '../providers/mollie-provider.js';
import { createStripeProvider } from '../providers/stripe-provider.js';
import { enqueueReconcile } from './enqueue-reconcile.js';

let database: Knex;

beforeEach(async () => {
	database = knex({
		client: 'sqlite3',
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
		pool: { min: 1, max: 1 },
	});

	await createSubscriptionTables.config.up(database);
	vi.useFakeTimers({ now: new Date('2026-11-05T00:00:00Z'), toFake: ['Date'] });
});

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	await database.destroy();
});

describe('enqueueReconcile', () => {
	test('queues ongoing subscriptions and those still holding access', async () => {
		await database('subscribers').insert({ user: 'user-1' });

		await database('subscriber_customers').insert([
			{ subscriber: 1, provider: 'stripe', provider_customer_id: 'cus_1' },
			{ subscriber: 1, provider: 'mollie', provider_customer_id: 'cst_1' },
		]);

		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 990,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert([
			{
				subscriber: 1,
				customer: 1,
				plan_reference: 1,
				provider: 'stripe',
				provider_subscription_id: 'sub_active',
				status: 'active',
				access: 'access-1',
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
			{
				subscriber: 1,
				customer: 1,
				plan_reference: 1,
				provider: 'stripe',
				provider_subscription_id: 'sub_ended',
				status: 'canceled',
				access: null,
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
			{
				subscriber: 1,
				customer: 2,
				plan_reference: 1,
				provider: 'mollie',
				provider_subscription_id: 'sub_expired',
				status: 'expired',
				access: 'access-2',
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
		]);

		expect(await enqueueReconcile(database, new Map([
			['stripe', createStripeProvider(new Stripe('sk_test_1'), 'whsec_1')],
			['mollie', createMollieProvider({} as MollieClient)],
		]))).toBe(2);

		expect(await database('subscription_sync_queue')
			.select('provider', 'resource_id', 'pending', 'next_attempt_at'))
			.toEqual([
				{
					provider: 'stripe',
					resource_id: 'sub_active',
					pending: 1,
					next_attempt_at: 1_793_836_800_000,
				},
				{
					provider: 'mollie',
					resource_id: 'cst_1/sub_expired',
					pending: 1,
					next_attempt_at: 1_793_836_800_000,
				},
			]);
	});

	test('leaves out a sync parked at the attempt ceiling', async () => {
		await database('subscribers').insert({ user: 'user-1' });

		await database('subscriber_customers')
			.insert({ subscriber: 1, provider: 'stripe', provider_customer_id: 'cus_1' });

		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 990,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert([
			{
				subscriber: 1,
				customer: 1,
				plan_reference: 1,
				provider: 'stripe',
				provider_subscription_id: 'sub_parked',
				status: 'active',
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
			{
				subscriber: 1,
				customer: 1,
				plan_reference: 1,
				provider: 'stripe',
				provider_subscription_id: 'sub_retrying',
				status: 'active',
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
		]);

		await database('subscription_sync_queue').insert([
			{
				provider: 'stripe',
				resource_id: 'sub_parked',
				pending: false,
				attempts: 48,
				next_attempt_at: new Date('2026-11-04T00:30:00Z'),
				last_error: 'Stripe is down',
			},
			{
				provider: 'stripe',
				resource_id: 'sub_retrying',
				pending: false,
				attempts: 47,
				next_attempt_at: new Date('2026-11-04T00:00:00Z'),
				last_error: 'Stripe is down',
			},
		]);

		await enqueueReconcile(database, new Map([
			['stripe', createStripeProvider(new Stripe('sk_test_1'), 'whsec_1')],
		]));

		expect(await database('subscription_sync_queue')
			.select('resource_id', 'pending'))
			.toEqual([
				{ resource_id: 'sub_parked', pending: 0 },
				{ resource_id: 'sub_retrying', pending: 1 },
			]);
	});

	test('queues a sync parked for a day, keeping its attempts', async () => {
		await database('subscribers').insert({ user: 'user-1' });

		await database('subscriber_customers')
			.insert({ subscriber: 1, provider: 'stripe', provider_customer_id: 'cus_1' });

		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan_reference: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_parked',
			status: 'active',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_sync_queue').insert({
			provider: 'stripe',
			resource_id: 'sub_parked',
			pending: false,
			attempts: 48,
			next_attempt_at: new Date('2026-11-03T23:30:00Z'),
			last_error: 'Stripe is down',
		});

		await enqueueReconcile(database, new Map([
			['stripe', createStripeProvider(new Stripe('sk_test_1'), 'whsec_1')],
		]));

		expect(await database('subscription_sync_queue')
			.select('resource_id', 'pending', 'attempts', 'last_error'))
			.toEqual([{
				resource_id: 'sub_parked',
				pending: 1,
				attempts: 48,
				last_error: 'Stripe is down',
			}]);
	});

	test('refuses subscriptions of disabled providers after the others', async () => {
		await database('subscribers').insert({ user: 'user-1' });

		await database('subscriber_customers').insert([
			{ subscriber: 1, provider: 'mollie', provider_customer_id: 'cst_1' },
			{ subscriber: 1, provider: 'stripe', provider_customer_id: 'cus_1' },
		]);

		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 990,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert([
			{
				subscriber: 1,
				customer: 1,
				plan_reference: 1,
				provider: 'mollie',
				provider_subscription_id: 'sub_1',
				status: 'active',
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
			{
				subscriber: 1,
				customer: 2,
				plan_reference: 1,
				provider: 'stripe',
				provider_subscription_id: 'sub_2',
				status: 'active',
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
		]);

		await expect(enqueueReconcile(database, new Map([
			['stripe', createStripeProvider(new Stripe('sk_test_1'), 'whsec_1')],
		]))).rejects.toThrow(new Error(
			'Subscriptions of disabled providers ["mollie"] were not reconciled',
		));

		expect(await database('subscription_sync_queue')
			.select('provider', 'resource_id'))
			.toEqual([{ provider: 'stripe', resource_id: 'sub_2' }]);
	});
});
