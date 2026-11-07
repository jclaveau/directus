import type { AbstractService } from '@directus/types';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import type { SubscriptionProvider } from '../providers/types.js';
import {
	closeMissingSubscription,
	selectStoredSubscription,
	syncSubscription,
} from './sync-subscription.js';

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
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn() },
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

		expect(await database('subscription_events')).toEqual([{
			id: 1,
			subscription: 1,
			status: 'active',
			current_period_end: 1_796_083_200_000,
			cancel_at_period_end: 0,
			source: 'sync',
			user: null,
			date_created: 1_793_836_800_000,
		}]);

		expect(await database('subscriptions')).toEqual([{
			id: 1,
			subscriber: 1,
			customer: 1,
			plan_reference: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: 1_796_083_200_000,
			cancel_at_period_end: 0,
			access: 'access-1',
			date_created: 1_793_836_800_000,
			date_updated: 1_793_836_800_000,
			user_updated: null,
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
			plan_reference: 1,
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
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn() },
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
			plan_reference: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'past_due',
			current_period_end: 1_796_083_200_000,
			cancel_at_period_end: 0,
			access: 'access-1',
			date_created: 1_790_812_800_000,
			date_updated: 1_793_836_800_000,
			user_updated: null,
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

		await database('subscription_plan_references').insert([
			{ plan: 1, provider: 'stripe', reference: 'price_1' },
			{ plan: 2, provider: 'stripe', reference: 'price_2' },
		]);

		await database('directus_access')
			.insert({ id: 'access-1', user: 'user-1', policy: 'policy-1' });

		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan_reference: 1,
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
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn() },
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
			.select('plan_reference', 'access'))
			.toEqual([{ plan_reference: 2, access: 'access-2' }]);
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
			plan_reference: 1,
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
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn() },
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
			plan_reference: 1,
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
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn() },
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
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn() },
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
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn() },
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
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn() },
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

	test('writes nothing when nothing changed', async () => {
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
			plan_reference: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			access: 'access-1',
			user_updated: 'user-9',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn() },
			accessService: {} as AbstractService,
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

		expect(await database('subscriptions')
			.select('user_updated', 'date_updated'))
			.toEqual([{ user_updated: 'user-9', date_updated: 1_790_812_800_000 }]);

		expect(await database('subscription_events')).toEqual([]);
	});

	test('records a change as the sync, clearing who last asked', async () => {
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
			plan_reference: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			access: 'access-1',
			user_updated: 'user-9',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn() },
			accessService: {} as AbstractService,
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

		expect(await database('subscriptions')
			.select('status', 'user_updated', 'date_updated'))
			.toEqual([{
				status: 'past_due',
				user_updated: null,
				date_updated: 1_793_836_800_000,
			}]);

		expect(await database('subscription_events')).toEqual([{
			id: 1,
			subscription: 1,
			status: 'past_due',
			current_period_end: 1_796_083_200_000,
			cancel_at_period_end: 0,
			source: 'sync',
			user: null,
			date_created: 1_793_836_800_000,
		}]);
	});

	test('revokes without the customer and plan reference', async () => {
		await database('subscribers').insert({ user: 'user-1' });

		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan_reference: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'active',
			access: 'access-1',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const accessService = { createOne: vi.fn(), deleteOne: vi.fn() };

		await syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn() },
			accessService: accessService as unknown as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_gone',
				status: 'unpaid',
				currentPeriodEnd: null,
				cancelAtPeriodEnd: false,
				planReference: 'price_gone',
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.deleteOne).toHaveBeenCalledWith('access-1');

		expect(await database('subscriptions')
			.select('status', 'plan_reference', 'access'))
			.toEqual([{ status: 'unpaid', plan_reference: 1, access: null }]);
	});

	test('cancels the revoked subscription of a deleted user', async () => {
		await database('subscribers').insert({ user: null });

		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan_reference: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'active',
			access: 'access-1',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const stripeProvider = {
			cancelAtPeriodEnd: vi.fn(),
			composeResourceId: vi.fn().mockReturnValue('sub_1'),
		};

		await syncSubscription({
			trx: database,
			subscriptionProvider: stripeProvider as unknown as SubscriptionProvider,
			logger: { warn: vi.fn() },
			accessService: {
				createOne: vi.fn(),
				deleteOne: vi.fn(),
			} as unknown as AbstractService,
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

		expect(stripeProvider.cancelAtPeriodEnd).toHaveBeenCalledWith('sub_1');

		expect(await database('subscriptions')
			.select('status', 'cancel_at_period_end', 'access'))
			.toEqual([{ status: 'unpaid', cancel_at_period_end: 1, access: null }]);

		expect(await database('subscription_events')
			.select('source', 'cancel_at_period_end'))
			.toEqual([{ source: 'user_deleted', cancel_at_period_end: 1 }]);
	});

	test.each([
		['canceled', false],
		['unpaid', true],
	])('does not cancel a %s subscription, cancelling: %s', async (
		providerStatus,
		isCancelling,
	) => {
		await database('subscribers').insert({ user: null });

		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan_reference: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'active',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const stripeProvider = {
			cancelAtPeriodEnd: vi.fn(),
			composeResourceId: vi.fn(),
		};

		await syncSubscription({
			trx: database,
			subscriptionProvider: stripeProvider as unknown as SubscriptionProvider,
			logger: { warn: vi.fn() },
			accessService: {} as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: providerStatus,
				currentPeriodEnd: null,
				cancelAtPeriodEnd: isCancelling,
				planReference: 'price_1',
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(stripeProvider.cancelAtPeriodEnd).not.toHaveBeenCalled();

		expect(await database('subscription_events').select('source'))
			.toEqual([{ source: 'sync' }]);
	});

	test('grants a paid subscription on a locked plan and warns', async () => {
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
			status: 'subscriptions-locked',
		});

		await database('subscription_plan_references')
			.insert({ plan: 1, provider: 'stripe', reference: 'price_1' });

		const accessService = {
			createOne: vi.fn().mockResolvedValue('access-1'),
			deleteOne: vi.fn(),
		};

		const logger = { warn: vi.fn() };

		await syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger,
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

		expect(logger.warn).toHaveBeenCalledWith(
			'Subscription "sub_1" started on plan 1, whose status is'
			+ ' "subscriptions-locked"',
		);

		expect(await database('subscriptions').select('access'))
			.toEqual([{ access: 'access-1' }]);
	});

	test('cancels the subscription of a deleted user and revokes it', async () => {
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

		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan_reference: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			access: 'access-1',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const accessService = { createOne: vi.fn(), deleteOne: vi.fn() };

		const subscriptionProvider = {
			cancelAtPeriodEnd: vi.fn(),
			composeResourceId: vi.fn().mockReturnValue('sub_1'),
		};

		await syncSubscription({
			trx: database,
			subscriptionProvider:
				subscriptionProvider as unknown as SubscriptionProvider,
			logger: { warn: vi.fn() },
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

		expect(subscriptionProvider.composeResourceId)
			.toHaveBeenCalledWith({ subscriptionId: 'sub_1', customerId: 'cus_1' });

		expect(subscriptionProvider.cancelAtPeriodEnd)
			.toHaveBeenCalledWith('sub_1');

		expect(accessService.createOne).not.toHaveBeenCalled();
		expect(accessService.deleteOne).toHaveBeenCalledWith('access-1');

		expect(await database('subscriptions')
			.select('cancel_at_period_end', 'access'))
			.toEqual([{ cancel_at_period_end: 1, access: null }]);

		expect(await database('subscription_events')
			.select('cancel_at_period_end', 'source', 'user'))
			.toEqual([{
				cancel_at_period_end: 1,
				source: 'user_deleted',
				user: null,
			}]);
	});

	test('cancels only once for a deleted user', async () => {
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

		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan_reference: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			cancel_at_period_end: true,
			access: null,
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const subscriptionProvider = { cancelAtPeriodEnd: vi.fn() };

		await syncSubscription({
			trx: database,
			subscriptionProvider:
				subscriptionProvider as unknown as SubscriptionProvider,
			logger: { warn: vi.fn() },
			accessService: {} as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'active',
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
				cancelAtPeriodEnd: true,
				planReference: 'price_1',
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(subscriptionProvider.cancelAtPeriodEnd).not.toHaveBeenCalled();
		expect(await database('subscription_events')).toEqual([]);
	});

	test('cancels a new subscription of a deleted user', async () => {
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

		const subscriptionProvider = {
			cancelAtPeriodEnd: vi.fn(),
			composeResourceId: vi.fn().mockReturnValue('sub_1'),
		};

		await syncSubscription({
			trx: database,
			subscriptionProvider:
				subscriptionProvider as unknown as SubscriptionProvider,
			logger: { warn: vi.fn() },
			accessService: {} as AbstractService,
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

		expect(await database('subscriptions')
			.select('cancel_at_period_end', 'access'))
			.toEqual([{ cancel_at_period_end: 1, access: null }]);

		expect(await database('subscription_events').select('source'))
			.toEqual([{ source: 'user_deleted' }]);
	});
});

describe('closeMissingSubscription', () => {
	test('marks the row canceled, revokes it, and keeps its history', async () => {
		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan_reference: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			access: 'access-1',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const accessService = { deleteOne: vi.fn() };

		await closeMissingSubscription({
			trx: database,
			accessService: accessService as unknown as AbstractService,
			providerName: 'stripe',
			subscriptionId: 'sub_1',
			closedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.deleteOne).toHaveBeenCalledWith('access-1');

		expect(await database('subscriptions')
			.select('status', 'current_period_end', 'access', 'date_updated'))
			.toEqual([{
				status: 'canceled',
				current_period_end: 1_796_083_200_000,
				access: null,
				date_updated: 1_793_836_800_000,
			}]);

		expect(await database('subscription_events')).toEqual([{
			id: 1,
			subscription: 1,
			status: 'canceled',
			current_period_end: 1_796_083_200_000,
			cancel_at_period_end: 0,
			source: 'provider_missing',
			user: null,
			date_created: 1_793_836_800_000,
		}]);
	});

	test.each([[null], ['sub_unknown']])(
		'has nothing to close for subscription %j',
		async (subscriptionId) => {
			await closeMissingSubscription({
				trx: database,
				accessService: {} as AbstractService,
				providerName: 'stripe',
				subscriptionId,
				closedAt: new Date('2026-11-05T00:00:00Z'),
			});

			expect(await database('subscription_events')).toEqual([]);
		},
	);
});

describe('selectStoredSubscription', () => {
	test('locks the row on postgres, so overlapping syncs grant one access', () => {
		expect(selectStoredSubscription(knex({ client: 'pg' }), 'mollie', 'sub_1')
			.toSQL()
			.toNative())
			.toEqual({
				sql: 'select "id", "subscriber", "customer", "plan", "status",'
					+ ' "current_period_end", "cancel_at_period_end", "access"'
					+ ' from "subscriptions"'
					+ ' where "provider" = $1 and "provider_subscription_id" = $2'
					+ ' limit $3 for update',
				bindings: ['mollie', 'sub_1', 1],
			});
	});
});
