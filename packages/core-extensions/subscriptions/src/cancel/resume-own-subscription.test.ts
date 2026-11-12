import { oneLine } from '@directus/utils';
import { ForbiddenError } from '@directus/errors';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	ArchivedPlanResumeError,
	NoSubscriptionToResumeError,
	SeveralSubscriptionsToResumeError,
} from '../errors.js';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import type { SubscriptionProvider } from '../providers/types.js';
import { resumeOwnSubscription } from './resume-own-subscription.js';

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
});

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	await database.destroy();
});

describe('resumeOwnSubscription', () => {
	test(oneLine`
		queues the sync of the new Mollie subscription, leaving the canceled row,
		and records who asked
	`, async () => {
		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan_reference: 1,
			provider: 'mollie',
			provider_subscription_id: 'sub_1',
			status: 'canceled',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			cancel_at_period_end: true,
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const resumeCancel = vi.fn().mockResolvedValue({
			resourceId: 'cst_1/sub_2',
			isNewSubscription: true,
		});

		await resumeOwnSubscription({
			database,
			enabledProviders: new Map([
				['mollie', { resumeCancel } as unknown as SubscriptionProvider],
			]),
			userId: 'user-1',
		});

		expect(resumeCancel).toHaveBeenCalledWith({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
			periodEnd: new Date('2026-12-01T00:00:00Z'),
		});

		expect(await database('subscription_sync_queue')
			.select('provider', 'resource_id', 'pending'))
			.toEqual([{ provider: 'mollie', resource_id: 'cst_1/sub_2', pending: 1 }]);

		expect(await database('subscriptions')
			.select('cancel_at_period_end', 'user_updated', 'date_updated'))
			.toEqual([{
				cancel_at_period_end: 1,
				user_updated: null,
				date_updated: 1_790_812_800_000,
			}]);

		expect(await database('subscription_events')).toEqual([{
			id: 1,
			subscription: 1,
			status: 'canceled',
			current_period_end: 1_796_083_200_000,
			cancel_at_period_end: 1,
			source: 'user',
			user: 'user-1',
			date_created: 1_793_836_800_000,
		}]);
	});

	test(oneLine`
		clears the cancel of a Stripe subscription and records who asked
	`, async () => {
		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan_reference: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			cancel_at_period_end: true,
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		// Same order as the sync worker, or the two deadlock on postgres.
		await database.raw(`
			CREATE TRIGGER queue_row_first BEFORE UPDATE ON subscriptions
			WHEN NOT EXISTS (SELECT 1 FROM subscription_sync_queue)
			BEGIN SELECT RAISE(ABORT, 'subscription updated before the queue'); END
		`);

		await resumeOwnSubscription({
			database,
			enabledProviders: new Map([[
				'stripe',
				{
					resumeCancel: vi.fn().mockResolvedValue({
						resourceId: 'sub_1',
						isNewSubscription: false,
					}),
				} as unknown as SubscriptionProvider,
			]]),
			userId: 'user-1',
		});

		expect(await database('subscription_sync_queue')
			.select('provider', 'resource_id', 'pending'))
			.toEqual([{ provider: 'stripe', resource_id: 'sub_1', pending: 1 }]);

		expect(await database('subscriptions')
			.select('cancel_at_period_end', 'user_updated', 'date_updated'))
			.toEqual([{
				cancel_at_period_end: 0,
				user_updated: 'user-1',
				date_updated: 1_793_836_800_000,
			}]);

		expect(await database('subscription_events')).toEqual([{
			id: 1,
			subscription: 1,
			status: 'active',
			current_period_end: 1_796_083_200_000,
			cancel_at_period_end: 0,
			source: 'user',
			user: 'user-1',
			date_created: 1_793_836_800_000,
		}]);
	});

	test('refuses an anonymous request', async () => {
		await expect(resumeOwnSubscription({
			database,
			enabledProviders: new Map(),
			userId: null,
		})).rejects.toThrow(new ForbiddenError());
	});

	test('refuses a cancel whose paid period is over', async () => {
		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan_reference: 1,
			provider: 'mollie',
			provider_subscription_id: 'sub_1',
			status: 'canceled',
			current_period_end: new Date('2026-11-05T00:00:00Z'),
			cancel_at_period_end: true,
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await expect(resumeOwnSubscription({
			database,
			enabledProviders: new Map(),
			userId: 'user-1',
		})).rejects.toThrow(new NoSubscriptionToResumeError());
	});

	test('refuses a subscription that is not cancelling', async () => {
		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan_reference: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'active',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			cancel_at_period_end: false,
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await expect(resumeOwnSubscription({
			database,
			enabledProviders: new Map(),
			userId: 'user-1',
		})).rejects.toThrow(new NoSubscriptionToResumeError());
	});

	test('refuses a Stripe subscription Stripe already canceled', async () => {
		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan_reference: 1,
			provider: 'stripe',
			provider_subscription_id: 'sub_1',
			status: 'canceled',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			cancel_at_period_end: true,
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const resumeCancel = vi.fn();

		await expect(resumeOwnSubscription({
			database,
			enabledProviders: new Map([
				['stripe', { resumeCancel } as unknown as SubscriptionProvider],
			]),
			userId: 'user-1',
		})).rejects.toThrow(new NoSubscriptionToResumeError());

		expect(resumeCancel).not.toHaveBeenCalled();
	});

	test('refuses a canceled subscription a stored one already resumes', async () => {
		await database('subscriptions').insert([
			{
				subscriber: 1,
				customer: 1,
				plan_reference: 1,
				provider: 'mollie',
				provider_subscription_id: 'sub_1',
				status: 'canceled',
				current_period_end: new Date('2026-12-01T00:00:00Z'),
				cancel_at_period_end: true,
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
			{
				subscriber: 1,
				customer: 1,
				plan_reference: 1,
				provider: 'mollie',
				provider_subscription_id: 'sub_2',
				status: 'active',
				current_period_end: new Date('2026-12-01T00:00:00Z'),
				cancel_at_period_end: false,
				resumes: 1,
				date_created: new Date('2026-11-01T00:00:00Z'),
				date_updated: new Date('2026-11-01T00:00:00Z'),
			},
		]);

		await expect(resumeOwnSubscription({
			database,
			enabledProviders: new Map(),
			userId: 'user-1',
		})).rejects.toThrow(new NoSubscriptionToResumeError());
	});

	test('refuses a user with several canceled subscriptions', async () => {
		await database('subscriptions').insert([
			{
				subscriber: 1,
				customer: 1,
				plan_reference: 1,
				provider: 'mollie',
				provider_subscription_id: 'sub_1',
				status: 'canceled',
				current_period_end: new Date('2026-12-01T00:00:00Z'),
				cancel_at_period_end: true,
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
			{
				subscriber: 1,
				customer: 1,
				plan_reference: 1,
				provider: 'mollie',
				provider_subscription_id: 'sub_2',
				status: 'canceled',
				current_period_end: new Date('2026-12-02T00:00:00Z'),
				cancel_at_period_end: true,
				date_created: new Date('2026-10-02T00:00:00Z'),
				date_updated: new Date('2026-10-02T00:00:00Z'),
			},
		]);

		await expect(resumeOwnSubscription({
			database,
			enabledProviders: new Map(),
			userId: 'user-1',
		})).rejects.toThrow(new SeveralSubscriptionsToResumeError({
			subscriptionCount: 2,
		}));
	});

	test('refuses a subscription of an archived plan', async () => {
		await database('subscription_plans')
			.where('id', 1)
			.update({ status: 'archived' });

		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan_reference: 1,
			provider: 'mollie',
			provider_subscription_id: 'sub_1',
			status: 'canceled',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			cancel_at_period_end: true,
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		const resumeCancel = vi.fn();

		await expect(resumeOwnSubscription({
			database,
			enabledProviders: new Map([
				['mollie', { resumeCancel } as unknown as SubscriptionProvider],
			]),
			userId: 'user-1',
		})).rejects.toThrow(new ArchivedPlanResumeError({ planCode: 'monthly' }));

		expect(resumeCancel).not.toHaveBeenCalled();
	});

	test('queues nothing when the provider refuses', async () => {
		await database('subscriptions').insert({
			subscriber: 1,
			customer: 1,
			plan_reference: 1,
			provider: 'mollie',
			provider_subscription_id: 'sub_1',
			status: 'canceled',
			current_period_end: new Date('2026-12-01T00:00:00Z'),
			cancel_at_period_end: true,
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await expect(resumeOwnSubscription({
			database,
			enabledProviders: new Map([[
				'mollie',
				{
					resumeCancel: vi.fn()
						.mockRejectedValue(new Error('Mollie is down')),
				} as unknown as SubscriptionProvider,
			]]),
			userId: 'user-1',
		})).rejects.toThrow(new Error('Mollie is down'));

		expect(await database('subscription_sync_queue')).toEqual([]);
	});
});
