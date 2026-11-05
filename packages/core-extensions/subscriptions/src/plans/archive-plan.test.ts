import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import type { Accountability } from '@directus/types';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { UnknownProviderError } from '../errors.js';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import type { SubscriptionProvider } from '../providers/types.js';
import { archivePlan } from './archive-plan.js';

let database: Knex;

beforeEach(async () => {
	database = knex({
		client: 'sqlite3',
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
		pool: { min: 1, max: 1 },
	});

	await createSubscriptionTables.config.up(database);

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
		interval: 'month',
	});

	vi.useFakeTimers({ now: new Date('2026-11-05T00:00:00Z'), toFake: ['Date'] });
});

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	await database.destroy();
});

describe('archivePlan', () => {
	test.each([
		[null, '1'],
		[{ admin: false }, '1'],
		[{ admin: true }, '1 or 1=1'],
		[{ admin: true }, '99'],
	])('refuses %j on plan %j', async (accountability, planId) => {
		await expect(archivePlan({
			database,
			enabledProviders: new Map(),
			planId,
			confirmation: undefined,
			accountability: accountability as Accountability | null,
		})).rejects.toThrow(new ForbiddenError());

		expect(await database('subscription_plans').select('status'))
			.toEqual([{ status: 'active' }]);
	});

	test('archives a plan ending nothing without a sentence', async () => {
		await database('subscriptions').insert([
			{
				subscriber: 1,
				customer: 1,
				plan: 1,
				provider: 'stripe',
				provider_subscription_id: 'sub_ended',
				status: 'canceled',
				cancel_at_period_end: false,
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
			{
				subscriber: 1,
				customer: 1,
				plan: 1,
				provider: 'stripe',
				provider_subscription_id: 'sub_ending',
				status: 'active',
				cancel_at_period_end: true,
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
		]);

		await expect(archivePlan({
			database,
			enabledProviders: new Map(),
			planId: '1',
			confirmation: undefined,
			accountability: { admin: true } as Accountability,
		})).resolves.toEqual({ status: 'archived', ending_subscriptions: 0 });

		expect(await database('subscription_plans').select('status'))
			.toEqual([{ status: 'archived' }]);
	});

	test('refuses without the sentence for one subscription', async () => {
		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'active',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const stripeProvider = { cancelAtPeriodEnd: vi.fn() };

		await expect(archivePlan({
			database,
			enabledProviders: new Map([
				['stripe', stripeProvider as unknown as SubscriptionProvider],
			]),
			planId: '1',
			confirmation: 'yes',
			accountability: { admin: true } as Accountability,
		})).rejects.toThrow(new InvalidPayloadError({
			reason: 'Type "End 1 subscription and lose this customer"'
				+ ' in "confirmation"',
		}));

		expect(stripeProvider.cancelAtPeriodEnd).not.toHaveBeenCalled();

		expect(await database('subscription_plans').select('status'))
			.toEqual([{ status: 'active' }]);
	});

	test('ends every ongoing subscription once the sentence is typed', async () => {
		await database('subscriptions').insert([
			{
				subscriber: 1,
				customer: 1,
				plan: 1,
				provider: 'stripe',
				provider_subscription_id: 'sub_1',
				status: 'active',
				current_period_end: new Date('2026-12-01T00:00:00Z'),
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
			{
				subscriber: 1,
				customer: 2,
				plan: 1,
				provider: 'mollie',
				provider_subscription_id: 'sub_2',
				status: 'past_due',
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
		]);

		const stripeProvider = {
			cancelAtPeriodEnd: vi.fn(),
			composeResourceId: vi.fn().mockReturnValue('sub_1'),
		};

		const mollieProvider = {
			cancelAtPeriodEnd: vi.fn(),
			composeResourceId: vi.fn().mockReturnValue('cst_1/sub_2'),
		};

		await expect(archivePlan({
			database,
			enabledProviders: new Map([
				['stripe', stripeProvider as unknown as SubscriptionProvider],
				['mollie', mollieProvider as unknown as SubscriptionProvider],
			]),
			planId: '1',
			confirmation: 'End 2 subscriptions and lose these customers',
			accountability: { admin: true, user: 'admin-1' } as Accountability,
		})).resolves.toEqual({ status: 'archived', ending_subscriptions: 2 });

		expect(stripeProvider.composeResourceId)
			.toHaveBeenCalledWith({ subscriptionId: 'sub_1', customerId: 'cus_1' });

		expect(stripeProvider.cancelAtPeriodEnd).toHaveBeenCalledWith('sub_1');
		expect(mollieProvider.cancelAtPeriodEnd).toHaveBeenCalledWith('cst_1/sub_2');

		expect(await database('subscriptions')
			.select('cancel_at_period_end', 'user_updated', 'date_updated'))
			.toEqual([
				{
					cancel_at_period_end: 1,
					user_updated: 'admin-1',
					date_updated: 1_793_836_800_000,
				},
				{
					cancel_at_period_end: 1,
					user_updated: 'admin-1',
					date_updated: 1_793_836_800_000,
				},
			]);

		expect(await database('subscription_events')).toEqual([
			{
				id: 1,
				subscription: 1,
				status: 'active',
				current_period_end: 1_796_083_200_000,
				cancel_at_period_end: 1,
				source: 'plan_archived',
				user: 'admin-1',
				date_created: 1_793_836_800_000,
			},
			{
				id: 2,
				subscription: 2,
				status: 'past_due',
				current_period_end: null,
				cancel_at_period_end: 1,
				source: 'plan_archived',
				user: 'admin-1',
				date_created: 1_793_836_800_000,
			},
		]);

		expect(await database('subscription_sync_queue')
			.select('provider', 'resource_id', 'pending'))
			.toEqual([
				{ provider: 'stripe', resource_id: 'sub_1', pending: 1 },
				{ provider: 'mollie', resource_id: 'cst_1/sub_2', pending: 1 },
			]);

		expect(await database('subscription_plans').select('status'))
			.toEqual([{ status: 'archived' }]);
	});

	test('records no user for a token without one', async () => {
		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'active',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await archivePlan({
			database,
			enabledProviders: new Map([['stripe', {
				cancelAtPeriodEnd: vi.fn(),
				composeResourceId: vi.fn().mockReturnValue('sub_1'),
			} as unknown as SubscriptionProvider]]),
			planId: '1',
			confirmation: 'End 1 subscription and lose this customer',
			accountability: { admin: true } as Accountability,
		});

		expect(await database('subscription_events').select('user'))
			.toEqual([{ user: null }]);
	});

	test('ends nothing when a provider is disabled', async () => {
		await database('subscriptions').insert([
			{
				subscriber: 1,
				customer: 1,
				plan: 1,
				provider: 'stripe',
				provider_subscription_id: 'sub_1',
				status: 'active',
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
			{
				subscriber: 1,
				customer: 2,
				plan: 1,
				provider: 'mollie',
				provider_subscription_id: 'sub_2',
				status: 'active',
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
		]);

		const stripeProvider = {
			cancelAtPeriodEnd: vi.fn(),
			composeResourceId: vi.fn().mockReturnValue('sub_1'),
		};

		await expect(archivePlan({
			database,
			enabledProviders: new Map([
				['stripe', stripeProvider as unknown as SubscriptionProvider],
			]),
			planId: '1',
			confirmation: 'End 2 subscriptions and lose these customers',
			accountability: { admin: true } as Accountability,
		})).rejects.toThrow(new UnknownProviderError({ provider: 'mollie' }));

		expect(stripeProvider.cancelAtPeriodEnd).not.toHaveBeenCalled();

		expect(await database('subscription_plans').select('status'))
			.toEqual([{ status: 'active' }]);
	});
});
