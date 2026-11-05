import type { AbstractService } from '@directus/types';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import { syncSubscription } from './sync-subscription.js';

let database: Knex;

beforeEach(async () => {
	database = knex({
		client: 'sqlite3',
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
		pool: { min: 1, max: 1 },
	});

	await database.schema.createTable('directus_access', (table) => {
		table.uuid('id');
		table.uuid('user');
		table.uuid('policy');
	});

	await createSubscriptionTables.config.up(database);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await database.destroy();
});

describe('syncSubscription', () => {
	test('stores a new active subscription and grants its access', async () => {
		await database('subscribers').insert({ user: 'user-1' });

		await database('subscriber_customers')
			.insert({ subscriber: 1, provider: 'stripe', provider_customer_id: 'cus_1' });

		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 990,
			currency: 'EUR',
			interval: 'month',
		});

		await database('subscription_plan_references')
			.insert({ plan: 1, provider: 'stripe', reference: 'price_1' });

		const accessService = {
			createOne: vi.fn().mockResolvedValue('access-1'),
			deleteOne: vi.fn(),
		};

		await syncSubscription({
			trx: database,
			accessService: accessService as unknown as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'active',
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				planReference: 'price_1',
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.createOne).toHaveBeenCalledWith({
			user: 'user-1',
			policy: 'policy-1',
			managed_by: '@scalabus/subscriptions',
		});

		expect(accessService.deleteOne).not.toHaveBeenCalled();

		expect(await database('subscriptions')).toEqual([{
			id: 1,
			subscriber: 1,
			customer: 1,
			plan: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: 1_796_083_200_000,
			cancel_at_period_end: 0,
			access: 'access-1',
			date_created: 1_793_836_800_000,
			date_updated: 1_793_836_800_000,
		}]);
	});

	test('keeps the access row already granted for the plan', async () => {
		await database('subscribers').insert({ user: 'user-1' });

		await database('subscriber_customers')
			.insert({ subscriber: 1, provider: 'stripe', provider_customer_id: 'cus_1' });

		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 990,
			currency: 'EUR',
			interval: 'month',
		});

		await database('subscription_plan_references')
			.insert({ plan: 1, provider: 'stripe', reference: 'price_1' });

		await database('directus_access')
			.insert({ id: 'access-1', user: 'user-1', policy: 'policy-1' });

		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'trialing',
			current_period_end: new Date('2026-11-01T00:00:00Z'),
			access: 'access-1',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const accessService = { createOne: vi.fn(), deleteOne: vi.fn() };

		await syncSubscription({
			trx: database,
			accessService: accessService as unknown as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'past_due',
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				planReference: 'price_1',
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.createOne).not.toHaveBeenCalled();
		expect(accessService.deleteOne).not.toHaveBeenCalled();

		expect(await database('subscriptions')).toEqual([{
			id: 1,
			subscriber: 1,
			customer: 1,
			plan: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'past_due',
			current_period_end: 1_796_083_200_000,
			cancel_at_period_end: 0,
			access: 'access-1',
			date_created: 1_790_812_800_000,
			date_updated: 1_793_836_800_000,
		}]);
	});

	test('regrants access when the plan changed policy', async () => {
		await database('subscribers').insert({ user: 'user-1' });

		await database('subscriber_customers')
			.insert({ subscriber: 1, provider: 'stripe', provider_customer_id: 'cus_1' });

		await database('subscription_plans').insert([
			{
				code: 'monthly',
				name: 'Monthly',
				policy: 'policy-1',
				amount: 990,
				currency: 'EUR',
				interval: 'month',
			},
			{
				code: 'yearly',
				name: 'Yearly',
				policy: 'policy-2',
				amount: 9900,
				currency: 'EUR',
				interval: 'year',
			},
		]);

		await database('subscription_plan_references')
			.insert({ plan: 2, provider: 'stripe', reference: 'price_2' });

		await database('directus_access')
			.insert({ id: 'access-1', user: 'user-1', policy: 'policy-1' });

		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'active',
			access: 'access-1',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const accessService = {
			createOne: vi.fn().mockResolvedValue('access-2'),
			deleteOne: vi.fn(),
		};

		await syncSubscription({
			trx: database,
			accessService: accessService as unknown as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'active',
				currentPeriodEnd: new Date('2027-11-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				planReference: 'price_2',
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.deleteOne).toHaveBeenCalledWith('access-1');

		expect(accessService.createOne).toHaveBeenCalledWith({
			user: 'user-1',
			policy: 'policy-2',
			managed_by: '@scalabus/subscriptions',
		});

		expect(await database('subscriptions')
			.select('plan', 'access')).toEqual([{ plan: 2, access: 'access-2' }]);
	});

	test('regrants access when the subscriber changed user', async () => {
		await database('subscribers').insert({ user: 'user-2' });

		await database('subscriber_customers')
			.insert({ subscriber: 1, provider: 'stripe', provider_customer_id: 'cus_1' });

		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 990,
			currency: 'EUR',
			interval: 'month',
		});

		await database('subscription_plan_references')
			.insert({ plan: 1, provider: 'stripe', reference: 'price_1' });

		await database('directus_access')
			.insert({ id: 'access-1', user: 'user-1', policy: 'policy-1' });

		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'active',
			access: 'access-1',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const accessService = {
			createOne: vi.fn().mockResolvedValue('access-2'),
			deleteOne: vi.fn(),
		};

		await syncSubscription({
			trx: database,
			accessService: accessService as unknown as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'active',
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				planReference: 'price_1',
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.deleteOne).toHaveBeenCalledWith('access-1');

		expect(accessService.createOne).toHaveBeenCalledWith({
			user: 'user-2',
			policy: 'policy-1',
			managed_by: '@scalabus/subscriptions',
		});
	});

	test('revokes the access of an ended subscription', async () => {
		await database('subscribers').insert({ user: 'user-1' });

		await database('subscriber_customers')
			.insert({ subscriber: 1, provider: 'mollie', provider_customer_id: 'cst_1' });

		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 990,
			currency: 'EUR',
			interval: 'month',
		});

		await database('subscription_plan_references')
			.insert({ plan: 1, provider: 'mollie', reference: 'monthly' });

		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan: 1,
			provider: 'mollie',
			provider_subscription_id: 'sub_1',
			status: 'canceled',
			cancel_at_period_end: true,
			access: 'access-1',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const accessService = { createOne: vi.fn(), deleteOne: vi.fn() };

		await syncSubscription({
			trx: database,
			accessService: accessService as unknown as AbstractService,
			providerName: 'mollie',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cst_1',
				status: 'canceled',
				currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
				cancelAtPeriodEnd: true,
				planReference: 'monthly',
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.deleteOne).toHaveBeenCalledWith('access-1');
		expect(accessService.createOne).not.toHaveBeenCalled();

		expect(await database('subscriptions')
			.select('status', 'access')).toEqual([{ status: 'canceled', access: null }]);
	});

	test('stores an unpaid subscription without granting access', async () => {
		await database('subscribers').insert({ user: null });

		await database('subscriber_customers')
			.insert({ subscriber: 1, provider: 'stripe', provider_customer_id: 'cus_1' });

		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 990,
			currency: 'EUR',
			interval: 'month',
		});

		await database('subscription_plan_references')
			.insert({ plan: 1, provider: 'stripe', reference: 'price_1' });

		const accessService = { createOne: vi.fn(), deleteOne: vi.fn() };

		await syncSubscription({
			trx: database,
			accessService: accessService as unknown as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'unpaid',
				currentPeriodEnd: null,
				cancelAtPeriodEnd: false,
				planReference: 'price_1',
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.deleteOne).not.toHaveBeenCalled();

		expect(await database('subscriptions')
			.select('status', 'current_period_end', 'access'))
			.toEqual([{ status: 'unpaid', current_period_end: null, access: null }]);
	});

	test('refuses a customer no subscriber holds', async () => {
		await expect(syncSubscription({
			trx: database,
			accessService: {} as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_unknown',
				status: 'active',
				currentPeriodEnd: null,
				cancelAtPeriodEnd: false,
				planReference: 'price_1',
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		})).rejects.toThrow(new Error(
			'No subscriber has "stripe" customer "cus_unknown"',
		));
	});

	test('refuses a plan reference no plan holds', async () => {
		await database('subscribers').insert({ user: 'user-1' });

		await database('subscriber_customers')
			.insert({ subscriber: 1, provider: 'stripe', provider_customer_id: 'cus_1' });

		await expect(syncSubscription({
			trx: database,
			accessService: {} as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'active',
				currentPeriodEnd: null,
				cancelAtPeriodEnd: false,
				planReference: 'price_unknown',
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		})).rejects.toThrow(new Error(
			'No plan has "stripe" reference "price_unknown"',
		));
	});

	test('refuses to grant access to a subscriber without user', async () => {
		await database('subscribers').insert({ user: null });

		await database('subscriber_customers')
			.insert({ subscriber: 1, provider: 'stripe', provider_customer_id: 'cus_1' });

		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 990,
			currency: 'EUR',
			interval: 'month',
		});

		await database('subscription_plan_references')
			.insert({ plan: 1, provider: 'stripe', reference: 'price_1' });

		await expect(syncSubscription({
			trx: database,
			accessService: {} as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'active',
				currentPeriodEnd: null,
				cancelAtPeriodEnd: false,
				planReference: 'price_1',
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		})).rejects.toThrow(new Error(
			'Subscriber 1 has no user to grant access to',
		));
	});
});
