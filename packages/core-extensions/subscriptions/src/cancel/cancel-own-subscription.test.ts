import { oneLine } from '@directus/utils';
import { ForbiddenError } from '@directus/errors';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	NoSubscriptionToCancelError,
	SeveralSubscriptionsToCancelError,
	UnknownProviderError,
} from '../errors.js';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import type { SubscriptionProvider } from '../providers/types.js';
import { cancelOwnSubscription } from './cancel-own-subscription.js';

let database: Knex;

beforeEach(async () => {
	database = knex({
		client: 'sqlite3',
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
		pool: { min: 1, max: 1 },
	});

	await createSubscriptionTables.config.up(database);
});

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	await database.destroy();
});

describe('cancelOwnSubscription', () => {
	test(oneLine`
		cancels the ongoing subscription at period end and queues its sync
	`, async () => {
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

		await database('subscriptions').insert([
			{
				subscriber: 1,
				customer: 1,
				plan: 1,
				provider: 'mollie',
				provider_subscription_id: 'sub_old',
				status: 'expired',
				date_created: new Date('2026-01-01T00:00:00Z'),
				date_updated: new Date('2026-01-01T00:00:00Z'),
			},
			{
				subscriber: 1,
				customer: 1,
				plan: 1,
				provider: 'mollie',
				provider_subscription_id: 'sub_1',
				status: 'active',
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
		]);

		const mollieProvider = {
			composeResourceId: vi.fn().mockReturnValue('cst_1/sub_1'),
			cancelAtPeriodEnd: vi.fn(),
		};

		await cancelOwnSubscription({
			database,
			enabledProviders: new Map([
				['mollie', mollieProvider as unknown as SubscriptionProvider],
			]),
			userId: 'user-1',
		});

		expect(mollieProvider.composeResourceId)
			.toHaveBeenCalledWith({ subscriptionId: 'sub_1', customerId: 'cst_1' });

		expect(mollieProvider.cancelAtPeriodEnd).toHaveBeenCalledWith('cst_1/sub_1');

		expect(await database('subscription_sync_queue')
			.select('provider', 'resource_id', 'pending', 'next_attempt_at'))
			.toEqual([{
				provider: 'mollie',
				resource_id: 'cst_1/sub_1',
				pending: 1,
				next_attempt_at: 1_793_836_800_000,
			}]);
	});

	test('refuses an anonymous request', async () => {
		await expect(cancelOwnSubscription({
			database,
			enabledProviders: new Map(),
			userId: null,
		})).rejects.toThrow(new ForbiddenError());
	});

	test('refuses a user without ongoing subscription', async () => {
		await database('subscribers').insert({ user: 'user-1' });

		await expect(cancelOwnSubscription({
			database,
			enabledProviders: new Map(),
			userId: 'user-1',
		})).rejects.toThrow(new NoSubscriptionToCancelError());
	});

	test('refuses a user with several ongoing subscriptions', async () => {
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
				customer: 1,
				plan: 1,
				provider: 'stripe',
				provider_subscription_id: 'sub_2',
				status: 'past_due',
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
		]);

		await expect(cancelOwnSubscription({
			database,
			enabledProviders: new Map(),
			userId: 'user-1',
		})).rejects.toThrow(new SeveralSubscriptionsToCancelError({
			subscriptionCount: 2,
		}));
	});

	test('refuses a subscription of a disabled provider', async () => {
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

		await expect(cancelOwnSubscription({
			database,
			enabledProviders: new Map(),
			userId: 'user-1',
		})).rejects.toThrow(new UnknownProviderError({ provider: 'stripe' }));
	});
});
