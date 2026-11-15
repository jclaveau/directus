import { oneLine } from '@directus/utils';
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
	test('binds the pending row and grants each beneficiary', async () => {
		await database('subscription_plans').insert({
			code: 'family',
			name: 'Family',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
			beneficiaries_max: 3,
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			status: 'pending',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_managers')
			.insert({ subscription: 1, user: 'user-1' });

		await database('subscription_beneficiaries').insert([
			{ subscription: 1, user: 'user-1' },
			{ subscription: 1, user: 'user-2' },
		]);

		const accessService = {
			createOne: vi.fn()
				.mockResolvedValueOnce('access-1')
				.mockResolvedValueOnce('access-2'),
			deleteOne: vi.fn(),
		};

		const logger = { warn: vi.fn(), error: vi.fn() };

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
				directusSubscription: 1,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.createOne).toHaveBeenNthCalledWith(1, {
			user: 'user-1',
			policy: 'policy-1',
			managed_by: '@scalabus/subscriptions',
		});

		expect(accessService.createOne).toHaveBeenNthCalledWith(2, {
			user: 'user-2',
			policy: 'policy-1',
			managed_by: '@scalabus/subscriptions',
		});

		expect(accessService.deleteOne).not.toHaveBeenCalled();
		expect(logger.warn).not.toHaveBeenCalled();
		expect(logger.error).not.toHaveBeenCalled();

		expect(await database('subscription_beneficiaries')).toEqual([
			{ id: 1, subscription: 1, user: 'user-1', access: 'access-1' },
			{ id: 2, subscription: 1, user: 'user-2', access: 'access-2' },
		]);

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
			plan: 1,
			continues: null,
			provider: 'stripe',
			provider_customer_id: 'cus_1',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: 1_796_083_200_000,
			cancel_at_period_end: 0,
			user_updated: null,
			date_created: 1_790_812_800_000,
			date_updated: 1_793_836_800_000,
		}]);
	});

	test('keeps the access already granted for the plan', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			provider_customer_id: 'cus_1',
			provider_subscription_id: 'sub_1',
			status: 'trialing',
			current_period_end: new Date('2026-11-01T00:00:00Z'),
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_managers')
			.insert({ subscription: 1, user: 'user-1' });

		await database('subscription_beneficiaries')
			.insert({ subscription: 1, user: 'user-1', access: 'access-1' });

		await database('directus_access')
			.insert({ id: 'access-1', user: 'user-1', policy: 'policy-1' });

		const accessService = {
			createOne: vi.fn(),
			updateOne: vi.fn(),
			deleteOne: vi.fn(),
		};

		await syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: accessService as unknown as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'past_due',
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				directusSubscription: 1,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.createOne).not.toHaveBeenCalled();
		expect(accessService.updateOne).not.toHaveBeenCalled();
		expect(accessService.deleteOne).not.toHaveBeenCalled();

		expect(await database('subscription_beneficiaries')).toEqual([
			{ id: 1, subscription: 1, user: 'user-1', access: 'access-1' },
		]);

		expect(await database('subscriptions')).toEqual([{
			id: 1,
			plan: 1,
			continues: null,
			provider: 'stripe',
			provider_customer_id: 'cus_1',
			provider_subscription_id: 'sub_1',
			status: 'past_due',
			current_period_end: 1_796_083_200_000,
			cancel_at_period_end: 0,
			user_updated: null,
			date_created: 1_790_812_800_000,
			date_updated: 1_793_836_800_000,
		}]);
	});

	test('moves an access to the policy the plan changed to', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-2',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			provider_customer_id: 'cus_1',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_managers')
			.insert({ subscription: 1, user: 'user-1' });

		await database('subscription_beneficiaries')
			.insert({ subscription: 1, user: 'user-1', access: 'access-1' });

		await database('directus_access')
			.insert({ id: 'access-1', user: 'user-1', policy: 'policy-1' });

		const accessService = { createOne: vi.fn(), updateOne: vi.fn() };

		await syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: accessService as unknown as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'active',
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				directusSubscription: 1,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.createOne).not.toHaveBeenCalled();

		expect(accessService.updateOne).toHaveBeenCalledWith(
			'access-1',
			{ user: 'user-1', policy: 'policy-2' },
		);
	});

	test('moves an access to the user the beneficiary changed to', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			provider_customer_id: 'cus_1',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_managers')
			.insert({ subscription: 1, user: 'user-1' });

		await database('subscription_beneficiaries')
			.insert({ subscription: 1, user: 'user-2', access: 'access-1' });

		await database('directus_access')
			.insert({ id: 'access-1', user: 'user-1', policy: 'policy-1' });

		const accessService = { createOne: vi.fn(), updateOne: vi.fn() };

		await syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: accessService as unknown as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'active',
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				directusSubscription: 1,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.createOne).not.toHaveBeenCalled();

		expect(accessService.updateOne).toHaveBeenCalledWith(
			'access-1',
			{ user: 'user-2', policy: 'policy-1' },
		);
	});

	test('revokes the accesses of an ended subscription', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			provider_customer_id: 'cus_1',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-11-01T00:00:00Z'),
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_managers')
			.insert({ subscription: 1, user: 'user-1' });

		await database('subscription_beneficiaries').insert([
			{ subscription: 1, user: 'user-1', access: 'access-1' },
			{ subscription: 1, user: 'user-2', access: 'access-2' },
		]);

		const accessService = { createOne: vi.fn(), deleteOne: vi.fn() };

		await syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: accessService as unknown as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'canceled',
				currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				directusSubscription: 1,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.createOne).not.toHaveBeenCalled();
		expect(accessService.deleteOne).toHaveBeenNthCalledWith(1, 'access-1');
		expect(accessService.deleteOne).toHaveBeenNthCalledWith(2, 'access-2');

		expect(await database('subscription_beneficiaries')).toEqual([
			{ id: 1, subscription: 1, user: 'user-1', access: null },
			{ id: 2, subscription: 1, user: 'user-2', access: null },
		]);

		expect(await database('subscription_events')).toEqual([{
			id: 1,
			subscription: 1,
			status: 'canceled',
			current_period_end: 1_793_491_200_000,
			cancel_at_period_end: 0,
			source: 'sync',
			user: null,
			date_created: 1_793_836_800_000,
		}]);
	});

	test('binds an unpaid subscription without granting it', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			status: 'pending',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_managers')
			.insert({ subscription: 1, user: 'user-1' });

		await database('subscription_beneficiaries')
			.insert({ subscription: 1, user: 'user-1' });

		const accessService = { createOne: vi.fn(), deleteOne: vi.fn() };

		await syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: accessService as unknown as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'unpaid',
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				directusSubscription: 1,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.createOne).not.toHaveBeenCalled();
		expect(accessService.deleteOne).not.toHaveBeenCalled();

		expect(await database('subscription_beneficiaries')).toEqual([
			{ id: 1, subscription: 1, user: 'user-1', access: null },
		]);

		expect(await database('subscriptions').select('status'))
			.toEqual([{ status: 'unpaid' }]);
	});

	test(oneLine`
		stores a resume after the chain's last row, with its plan, customer,
		managers and beneficiaries
	`, async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
			beneficiaries_max: 2,
		});

		// Resumed once already, then canceled before its first charge.
		await database('subscriptions').insert([
			{
				plan: 1,
				provider: 'mollie',
				provider_customer_id: 'cst_1',
				provider_subscription_id: 'sub_1',
				status: 'canceled',
				current_period_end: new Date('2026-12-01T00:00:00Z'),
				cancel_at_period_end: true,
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
			{
				plan: 1,
				continues: 1,
				provider: 'mollie',
				provider_customer_id: 'cst_1',
				provider_subscription_id: 'sub_2',
				status: 'canceled',
				current_period_end: new Date('2026-12-01T00:00:00Z'),
				cancel_at_period_end: true,
				date_created: new Date('2026-11-01T00:00:00Z'),
				date_updated: new Date('2026-11-01T00:00:00Z'),
			},
		]);

		await database('subscription_managers').insert([
			{ subscription: 1, user: 'user-1' },
			{ subscription: 2, user: 'user-1' },
			{ subscription: 2, user: 'user-3' },
		]);

		await database('subscription_beneficiaries').insert([
			{ subscription: 1, user: 'user-1', access: 'access-1' },
			{ subscription: 2, user: 'user-1', access: 'access-1' },
			{ subscription: 2, user: 'user-2', access: 'access-2' },
		]);

		await database('directus_access').insert([
			{ id: 'access-1', user: 'user-1', policy: 'policy-1' },
			{ id: 'access-2', user: 'user-2', policy: 'policy-1' },
		]);

		const accessService = {
			createOne: vi.fn(),
			updateOne: vi.fn(),
			deleteOne: vi.fn(),
		};

		await syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: accessService as unknown as AbstractService,
			providerName: 'mollie',
			providerSubscription: {
				subscriptionId: 'sub_3',
				customerId: 'cst_1',
				status: 'active',
				currentPeriodEnd: new Date('2027-01-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				directusSubscription: null,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
				resumedSubscriptionId: 'sub_1',
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.createOne).not.toHaveBeenCalled();
		expect(accessService.updateOne).not.toHaveBeenCalled();
		expect(accessService.deleteOne).not.toHaveBeenCalled();

		expect(await database('subscriptions').where('id', 3)).toEqual([{
			id: 3,
			plan: 1,
			continues: 2,
			provider: 'mollie',
			provider_customer_id: 'cst_1',
			provider_subscription_id: 'sub_3',
			status: 'active',
			current_period_end: 1_798_761_600_000,
			cancel_at_period_end: 0,
			user_updated: null,
			date_created: 1_793_836_800_000,
			date_updated: 1_793_836_800_000,
		}]);

		expect(await database('subscription_managers').where('subscription', 3))
			.toEqual([
				{ id: 4, subscription: 3, user: 'user-1' },
				{ id: 5, subscription: 3, user: 'user-3' },
			]);

		expect(await database('subscription_beneficiaries')
			.where('subscription', 3))
			.toEqual([
				{ id: 4, subscription: 3, user: 'user-1', access: 'access-1' },
				{ id: 5, subscription: 3, user: 'user-2', access: 'access-2' },
			]);
	});

	test('stores a resume of a chain whose last row has no member', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'mollie',
			provider_customer_id: 'cst_1',
			provider_subscription_id: 'sub_1',
			status: 'canceled',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			cancel_at_period_end: true,
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const subscriptionProvider = {
			cancelAtPeriodEnd: vi.fn(),
			composeResourceId: vi.fn().mockReturnValue('cst_1/sub_2'),
		};

		await syncSubscription({
			trx: database,
			subscriptionProvider:
				subscriptionProvider as unknown as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: {} as AbstractService,
			providerName: 'mollie',
			providerSubscription: {
				subscriptionId: 'sub_2',
				customerId: 'cst_1',
				status: 'active',
				currentPeriodEnd: new Date('2027-01-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				directusSubscription: null,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
				resumedSubscriptionId: 'sub_1',
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(subscriptionProvider.cancelAtPeriodEnd)
			.toHaveBeenCalledWith('cst_1/sub_2');

		expect(await database('subscription_managers')).toEqual([]);
		expect(await database('subscription_beneficiaries')).toEqual([]);

		expect(await database('subscriptions')
			.select('id', 'continues', 'cancel_at_period_end')
			.where('id', 2))
			.toEqual([{ id: 2, continues: 1, cancel_at_period_end: 1 }]);
	});

	test('keeps an access a resume shares when the resumed row ends', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert([
			{
				plan: 1,
				provider: 'mollie',
				provider_customer_id: 'cst_1',
				provider_subscription_id: 'sub_1',
				status: 'canceled',
				current_period_end: new Date('2026-11-01T00:00:00Z'),
				cancel_at_period_end: true,
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
			{
				plan: 1,
				continues: 1,
				provider: 'mollie',
				provider_customer_id: 'cst_1',
				provider_subscription_id: 'sub_2',
				status: 'active',
				current_period_end: new Date('2026-12-01T00:00:00Z'),
				cancel_at_period_end: false,
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
		]);

		await database('subscription_managers').insert([
			{ subscription: 1, user: 'user-1' },
			{ subscription: 2, user: 'user-1' },
		]);

		await database('subscription_beneficiaries').insert([
			{ subscription: 1, user: 'user-1', access: 'access-1' },
			{ subscription: 2, user: 'user-1', access: 'access-1' },
		]);

		const accessService = { deleteOne: vi.fn() };

		await syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: accessService as unknown as AbstractService,
			providerName: 'mollie',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cst_1',
				status: 'canceled',
				currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
				cancelAtPeriodEnd: true,
				directusSubscription: null,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.deleteOne).not.toHaveBeenCalled();

		expect(await database('subscription_beneficiaries')).toEqual([
			{ id: 1, subscription: 1, user: 'user-1', access: null },
			{ id: 2, subscription: 2, user: 'user-1', access: 'access-1' },
		]);
	});

	test(oneLine`
		grants a second resume the access the resumed row still holds
	`, async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert([
			{
				plan: 1,
				provider: 'mollie',
				provider_customer_id: 'cst_1',
				provider_subscription_id: 'sub_1',
				status: 'canceled',
				current_period_end: new Date('2026-12-01T00:00:00Z'),
				cancel_at_period_end: true,
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
			{
				plan: 1,
				continues: 1,
				provider: 'mollie',
				provider_customer_id: 'cst_1',
				provider_subscription_id: 'sub_2',
				status: 'canceled',
				current_period_end: null,
				cancel_at_period_end: true,
				date_created: new Date('2026-11-01T00:00:00Z'),
				date_updated: new Date('2026-11-01T00:00:00Z'),
			},
		]);

		await database('directus_access')
			.insert({ id: 'access-1', user: 'user-1', policy: 'policy-1' });

		await database('subscription_managers').insert([
			{ subscription: 1, user: 'user-1' },
			{ subscription: 2, user: 'user-1' },
		]);

		await database('subscription_beneficiaries').insert([
			{ subscription: 1, user: 'user-1', access: 'access-1' },
			{ subscription: 2, user: 'user-1', access: null },
		]);

		const accessService = { createOne: vi.fn(), updateOne: vi.fn() };

		await syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: accessService as unknown as AbstractService,
			providerName: 'mollie',
			providerSubscription: {
				subscriptionId: 'sub_3',
				customerId: 'cst_1',
				status: 'active',
				currentPeriodEnd: new Date('2027-01-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				directusSubscription: null,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
				resumedSubscriptionId: 'sub_1',
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.createOne).not.toHaveBeenCalled();

		expect(await database('subscription_beneficiaries')).toEqual([
			{ id: 1, subscription: 1, user: 'user-1', access: 'access-1' },
			{ id: 2, subscription: 2, user: 'user-1', access: null },
			{ id: 3, subscription: 3, user: 'user-1', access: 'access-1' },
		]);
	});

	test('refuses a resume of a row not stored', async () => {
		const syncing = syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: {} as AbstractService,
			providerName: 'mollie',
			providerSubscription: {
				subscriptionId: 'sub_2',
				customerId: 'cst_1',
				status: 'active',
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				directusSubscription: null,
				billing: null,
				resumedSubscriptionId: 'sub_1',
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		await expect(syncing).rejects.toThrow(
			'Subscription "sub_2" resumes "sub_1", which is not stored',
		);

		expect(await database('subscriptions')).toEqual([]);
	});

	test.each([
		[null, 'null'],
		[2, '2'],
		[1, '1'],
	])(
		'refuses a subscription whose metadata names %j',
		async (directusSubscription, namedSubscription) => {
			// Row 1 is pending for another provider.
			await database('subscription_plans').insert({
				code: 'monthly',
				name: 'Monthly',
				policy: 'policy-1',
				amount: 10,
				currency: 'EUR',
				interval: '{"months":1}',
			});

			await database('subscriptions').insert({
				plan: 1,
				provider: 'mollie',
				status: 'pending',
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			});

			const syncing = syncSubscription({
				trx: database,
				subscriptionProvider: {} as SubscriptionProvider,
				logger: { warn: vi.fn(), error: vi.fn() },
				accessService: {} as AbstractService,
				providerName: 'stripe',
				providerSubscription: {
					subscriptionId: 'sub_1',
					customerId: 'cus_1',
					status: 'active',
					currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
					cancelAtPeriodEnd: false,
					directusSubscription,
					billing: null,
				},
				syncedAt: new Date('2026-11-05T00:00:00Z'),
			});

			await expect(syncing).rejects.toThrow(
				'"stripe" subscription "sub_1" names no pending subscription:'
				+ ` its metadata "directus_subscription" is ${namedSubscription}`,
			);

			expect(await database('subscription_events')).toEqual([]);
		},
	);

	test('writes nothing when nothing changed', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			provider_customer_id: 'cus_1',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			user_updated: 'admin-1',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_managers')
			.insert({ subscription: 1, user: 'user-1' });

		await database('subscription_beneficiaries')
			.insert({ subscription: 1, user: 'user-1', access: 'access-1' });

		await database('directus_access')
			.insert({ id: 'access-1', user: 'user-1', policy: 'policy-1' });

		await syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: {} as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'active',
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				directusSubscription: 1,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(await database('subscription_events')).toEqual([]);

		expect(await database('subscriptions')
			.select('user_updated', 'date_updated'))
			.toEqual([{
				user_updated: 'admin-1',
				date_updated: 1_790_812_800_000,
			}]);
	});

	test('records a change as the sync, clearing who last asked', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			provider_customer_id: 'cus_1',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			user_updated: 'admin-1',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_managers')
			.insert({ subscription: 1, user: 'user-1' });

		await syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: {} as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'active',
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
				cancelAtPeriodEnd: true,
				directusSubscription: 1,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(await database('subscriptions')
			.select('cancel_at_period_end', 'user_updated', 'date_updated'))
			.toEqual([{
				cancel_at_period_end: 1,
				user_updated: null,
				date_updated: 1_793_836_800_000,
			}]);

		expect(await database('subscription_events')).toEqual([{
			id: 1,
			subscription: 1,
			status: 'active',
			current_period_end: 1_796_083_200_000,
			cancel_at_period_end: 1,
			source: 'sync',
			user: null,
			date_created: 1_793_836_800_000,
		}]);
	});

	test.each([
		[
			{
				amountCents: 1200,
				currency: 'EUR',
				interval: { months: 1, days: 0 },
			},
			'{"amountCents":1200,"currency":"EUR","interval":{"months":1,"days":0}}',
		],
		[
			{
				amountCents: 1000,
				currency: 'USD',
				interval: { months: 1, days: 0 },
			},
			'{"amountCents":1000,"currency":"USD","interval":{"months":1,"days":0}}',
		],
		[
			{
				amountCents: 1000,
				currency: 'EUR',
				interval: { months: 12, days: 0 },
			},
			'{"amountCents":1000,"currency":"EUR","interval":{"months":12,"days":0}}',
		],
		[
			{
				amountCents: 1000,
				currency: 'EUR',
				interval: { months: 1, days: 7 },
			},
			'{"amountCents":1000,"currency":"EUR","interval":{"months":1,"days":7}}',
		],
		[null, 'null'],
	])(
		'logs a provider billing %j the plan does not sell',
		async (providerBilling, loggedBilling) => {
			await database('subscription_plans').insert({
				code: 'monthly',
				name: 'Monthly',
				policy: 'policy-1',
				amount: 10,
				currency: 'eur',
				interval: '{"months":1}',
			});

			await database('subscriptions').insert({
				plan: 1,
				provider: 'stripe',
				provider_customer_id: 'cus_1',
				provider_subscription_id: 'sub_1',
				status: 'active',
				current_period_end: new Date('2026-12-01T00:00:00Z'),
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			});

			await database('subscription_managers')
				.insert({ subscription: 1, user: 'user-1' });

			const logger = { warn: vi.fn(), error: vi.fn() };

			await syncSubscription({
				trx: database,
				subscriptionProvider: {} as SubscriptionProvider,
				logger,
				accessService: {} as AbstractService,
				providerName: 'stripe',
				providerSubscription: {
					subscriptionId: 'sub_1',
					customerId: 'cus_1',
					status: 'active',
					currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
					cancelAtPeriodEnd: false,
					directusSubscription: 1,
					billing: providerBilling,
				},
				syncedAt: new Date('2026-11-05T00:00:00Z'),
			});

			expect(logger.error).toHaveBeenCalledWith(
				`Subscription 1 is billed ${loggedBilling} by "stripe", its plan`
				+ ' "monthly" sells {"amountCents":1000,"currency":"EUR",'
				+ '"interval":{"months":1,"days":0}}',
			);
		},
	);

	test('reads years as 12 months and weeks as 7 days', async () => {
		await database('subscription_plans').insert({
			code: 'yearly',
			name: 'Yearly',
			policy: 'policy-1',
			amount: 100,
			currency: 'EUR',
			interval: '{"years":1,"months":1,"weeks":2,"days":1}',
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			provider_customer_id: 'cus_1',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_managers')
			.insert({ subscription: 1, user: 'user-1' });

		const logger = { warn: vi.fn(), error: vi.fn() };

		await syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger,
			accessService: {} as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'active',
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				directusSubscription: 1,
				billing: {
					amountCents: 10_000,
					currency: 'EUR',
					interval: { months: 13, days: 15 },
				},
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(logger.error).not.toHaveBeenCalled();
	});

	test('refuses a plan interval part that is not a number', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":"1"}',
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			provider_customer_id: 'cus_1',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const syncing = syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: {} as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'active',
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				directusSubscription: 1,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		await expect(syncing).rejects.toThrow(
			'Plan "monthly" has interval "{\\"months\\":\\"1\\"}", whose "months"'
			+ ' is not a number',
		);
	});

	test('grants a paid subscription on a locked plan and warns', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
			status: 'subscriptions-locked',
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			status: 'pending',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_managers')
			.insert({ subscription: 1, user: 'user-1' });

		await database('subscription_beneficiaries')
			.insert({ subscription: 1, user: 'user-1' });

		const accessService = {
			createOne: vi.fn().mockResolvedValue('access-1'),
		};

		const logger = { warn: vi.fn(), error: vi.fn() };

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
				directusSubscription: 1,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(logger.warn).toHaveBeenCalledWith(
			'Subscription 1 started on plan "monthly", whose status is'
			+ ' "subscriptions-locked"',
		);

		expect(await database('subscription_beneficiaries')).toEqual([
			{ id: 1, subscription: 1, user: 'user-1', access: 'access-1' },
		]);
	});

	test('skips a beneficiary whose account was deleted', async () => {
		await database('subscription_plans').insert({
			code: 'family',
			name: 'Family',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
			beneficiaries_max: 2,
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			status: 'pending',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_managers')
			.insert({ subscription: 1, user: 'user-1' });

		await database('subscription_beneficiaries').insert([
			{ subscription: 1, user: null },
			{ subscription: 1, user: 'user-2' },
		]);

		const accessService = {
			createOne: vi.fn().mockResolvedValue('access-2'),
		};

		await syncSubscription({
			trx: database,
			subscriptionProvider: {} as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: accessService as unknown as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'active',
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				directusSubscription: 1,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.createOne).toHaveBeenCalledOnce();

		expect(await database('subscription_beneficiaries')).toEqual([
			{ id: 1, subscription: 1, user: null, access: null },
			{ id: 2, subscription: 1, user: 'user-2', access: 'access-2' },
		]);
	});

	test(oneLine`
		cancels at period end a subscription no one manages, its beneficiaries
		keeping their access till then
	`, async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			provider_customer_id: 'cus_1',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_beneficiaries')
			.insert({ subscription: 1, user: 'user-2', access: 'access-2' });

		await database('directus_access')
			.insert({ id: 'access-2', user: 'user-2', policy: 'policy-1' });

		const subscriptionProvider = {
			cancelAtPeriodEnd: vi.fn(),
			composeResourceId: vi.fn().mockReturnValue('sub_1'),
		};

		const accessService = { deleteOne: vi.fn() };

		await syncSubscription({
			trx: database,
			subscriptionProvider:
				subscriptionProvider as unknown as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: accessService as unknown as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'active',
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				directusSubscription: 1,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(subscriptionProvider.composeResourceId).toHaveBeenCalledWith({
			subscriptionId: 'sub_1',
			customerId: 'cus_1',
		});

		expect(subscriptionProvider.cancelAtPeriodEnd)
			.toHaveBeenCalledWith('sub_1');

		expect(accessService.deleteOne).not.toHaveBeenCalled();

		expect(await database('subscription_beneficiaries')).toEqual([
			{ id: 1, subscription: 1, user: 'user-2', access: 'access-2' },
		]);

		expect(await database('subscription_events')).toEqual([{
			id: 1,
			subscription: 1,
			status: 'active',
			current_period_end: 1_796_083_200_000,
			cancel_at_period_end: 1,
			source: 'user_deleted',
			user: null,
			date_created: 1_793_836_800_000,
		}]);
	});

	test('cancels a subscription no one manages only once', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			provider_customer_id: 'cus_1',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const subscriptionProvider = { cancelAtPeriodEnd: vi.fn() };

		await syncSubscription({
			trx: database,
			subscriptionProvider:
				subscriptionProvider as unknown as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: {} as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'active',
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
				cancelAtPeriodEnd: true,
				directusSubscription: 1,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(subscriptionProvider.cancelAtPeriodEnd).not.toHaveBeenCalled();

		expect(await database('subscription_events').select('source'))
			.toEqual([{ source: 'sync' }]);
	});

	test('cancels an unpaid subscription no one manages', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			provider_customer_id: 'cus_1',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_beneficiaries')
			.insert({ subscription: 1, user: 'user-2', access: 'access-2' });

		const subscriptionProvider = {
			cancelAtPeriodEnd: vi.fn(),
			composeResourceId: vi.fn().mockReturnValue('sub_1'),
		};

		const accessService = { deleteOne: vi.fn() };

		await syncSubscription({
			trx: database,
			subscriptionProvider:
				subscriptionProvider as unknown as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: accessService as unknown as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'unpaid',
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				directusSubscription: 1,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(subscriptionProvider.cancelAtPeriodEnd)
			.toHaveBeenCalledWith('sub_1');

		expect(accessService.deleteOne).toHaveBeenCalledWith('access-2');

		expect(await database('subscriptions')
			.select('status', 'cancel_at_period_end'))
			.toEqual([{ status: 'unpaid', cancel_at_period_end: 1 }]);

		expect(await database('subscription_events').select('source'))
			.toEqual([{ source: 'user_deleted' }]);
	});

	test('cancels no ended subscription no one manages', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			provider_customer_id: 'cus_1',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-11-01T00:00:00Z'),
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const subscriptionProvider = { cancelAtPeriodEnd: vi.fn() };

		await syncSubscription({
			trx: database,
			subscriptionProvider:
				subscriptionProvider as unknown as SubscriptionProvider,
			logger: { warn: vi.fn(), error: vi.fn() },
			accessService: {} as AbstractService,
			providerName: 'stripe',
			providerSubscription: {
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				status: 'canceled',
				currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
				cancelAtPeriodEnd: false,
				directusSubscription: 1,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
			},
			syncedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(subscriptionProvider.cancelAtPeriodEnd).not.toHaveBeenCalled();

		expect(await database('subscription_events').select('source'))
			.toEqual([{ source: 'sync' }]);
	});
});

describe('closeMissingSubscription', () => {
	test('marks the row canceled, revokes it, and keeps its history', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			provider_customer_id: 'cus_1',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_beneficiaries')
			.insert({ subscription: 1, user: 'user-1', access: 'access-1' });

		const accessService = { deleteOne: vi.fn() };

		await closeMissingSubscription({
			trx: database,
			accessService: accessService as unknown as AbstractService,
			providerName: 'stripe',
			subscriptionId: 'sub_1',
			closedAt: new Date('2026-11-05T00:00:00Z'),
		});

		expect(accessService.deleteOne).toHaveBeenCalledWith('access-1');

		expect(await database('subscription_beneficiaries')).toEqual([
			{ id: 1, subscription: 1, user: 'user-1', access: null },
		]);

		expect(await database('subscriptions')
			.select('status', 'current_period_end', 'date_updated'))
			.toEqual([{
				status: 'canceled',
				current_period_end: 1_796_083_200_000,
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
				sql: 'select "id", "plan", "provider_customer_id",'
					+ ' "provider_subscription_id", "status",'
					+ ' "current_period_end", "cancel_at_period_end"'
					+ ' from "subscriptions"'
					+ ' where "provider" = $1 and "provider_subscription_id" = $2'
					+ ' limit $3 for update',
				bindings: ['mollie', 'sub_1', 1],
			});
	});
});
