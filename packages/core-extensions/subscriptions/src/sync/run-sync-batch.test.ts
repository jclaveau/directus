import type { AbstractService } from '@directus/types';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import type { SubscriptionProvider } from '../providers/types.js';
import { runSyncBatch } from './run-sync-batch.js';

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
	vi.useFakeTimers({ now: new Date('2026-11-05T00:00:00Z'), toFake: ['Date'] });
});

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	await database.destroy();
});

describe('runSyncBatch', () => {
	test('claims nothing from an empty queue', async () => {
		expect(await runSyncBatch({
			database,
			enabledProviders: new Map(),
			createAccessService: vi.fn(),
			logger: { warn: vi.fn() },
		})).toBe(0);
	});

	test('syncs a due row and clears it', async () => {
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

		await database('subscription_sync_queue').insert({
			provider: 'stripe',
			resource_id: 'sub_1',
			pending: true,
			attempts: 2,
			next_attempt_at: new Date('2026-11-04T00:00:00Z'),
			last_error: 'Stripe is down',
		});

		const fetchSubscription = vi.fn().mockResolvedValue({
			subscriptionId: 'sub_1',
			customerId: 'cus_1',
			status: 'active',
			currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
			cancelAtPeriodEnd: false,
			planReference: 'price_1',
		});

		const accessService = { createOne: vi.fn().mockResolvedValue('access-1') };
		const logger = { warn: vi.fn() };

		expect(await runSyncBatch({
			database,
			enabledProviders: new Map([
				['stripe', { fetchSubscription } as unknown as SubscriptionProvider],
			]),
			createAccessService: () => accessService as unknown as AbstractService,
			logger,
		})).toBe(1);

		expect(fetchSubscription).toHaveBeenCalledWith('sub_1');
		expect(logger.warn).not.toHaveBeenCalled();

		expect(await database('subscription_sync_queue')).toEqual([{
			id: 1,
			provider: 'stripe',
			resource_id: 'sub_1',
			pending: 0,
			attempts: 0,
			next_attempt_at: 1_793_750_400_000,
			last_error: null,
		}]);

		expect(await database('subscriptions')
			.select('provider_subscription_id', 'status', 'access'))
			.toEqual([{
				provider_subscription_id: 'sub_1',
				status: 'active',
				access: 'access-1',
			}]);
	});

	test('records a failed sync with a doubled retry delay', async () => {
		await database('subscription_sync_queue').insert({
			provider: 'stripe',
			resource_id: 'sub_1',
			pending: true,
			attempts: 2,
			next_attempt_at: new Date('2026-11-04T00:00:00Z'),
			last_error: null,
		});

		const logger = { warn: vi.fn() };

		expect(await runSyncBatch({
			database,
			enabledProviders: new Map([[
				'stripe',
				{
					fetchSubscription: vi.fn()
						.mockRejectedValue(new Error('Stripe is down')),
				} as unknown as SubscriptionProvider,
			]]),
			createAccessService: vi.fn(),
			logger,
		})).toBe(1);

		expect(logger.warn).toHaveBeenCalledWith(
			'Subscription sync of "stripe" "sub_1" failed, attempt 3:'
			+ ' "Stripe is down"',
		);

		expect(await database('subscription_sync_queue')).toEqual([{
			id: 1,
			provider: 'stripe',
			resource_id: 'sub_1',
			pending: 1,
			attempts: 3,
			next_attempt_at: 1_793_837_040_000,
			last_error: 'Stripe is down',
		}]);
	});

	test('caps the retry delay at one hour', async () => {
		await database('subscription_sync_queue').insert({
			provider: 'stripe',
			resource_id: 'sub_1',
			pending: true,
			attempts: 9,
			next_attempt_at: new Date('2026-11-04T00:00:00Z'),
			last_error: null,
		});

		await runSyncBatch({
			database,
			enabledProviders: new Map(),
			createAccessService: vi.fn(),
			logger: { warn: vi.fn() },
		});

		expect(await database('subscription_sync_queue')).toEqual([{
			id: 1,
			provider: 'stripe',
			resource_id: 'sub_1',
			pending: 1,
			attempts: 10,
			next_attempt_at: 1_793_840_400_000,
			last_error: 'Subscription provider "stripe" is not enabled',
		}]);
	});

	test('records a thrown non-error as JSON', async () => {
		await database('subscription_sync_queue').insert({
			provider: 'mollie',
			resource_id: 'cst_1/sub_1',
			pending: true,
			attempts: 0,
			next_attempt_at: new Date('2026-11-04T00:00:00Z'),
			last_error: null,
		});

		const logger = { warn: vi.fn() };

		await runSyncBatch({
			database,
			enabledProviders: new Map([[
				'mollie',
				{
					fetchSubscription: vi.fn()
						.mockRejectedValue('Mollie is down'),
				} as unknown as SubscriptionProvider,
			]]),
			createAccessService: vi.fn(),
			logger,
		});

		expect(logger.warn).toHaveBeenCalledWith(
			'Subscription sync of "mollie" "cst_1/sub_1" failed, attempt 1:'
			+ ' "\\"Mollie is down\\""',
		);

		expect(await database('subscription_sync_queue')
			.select('attempts', 'next_attempt_at', 'last_error'))
			.toEqual([{
				attempts: 1,
				next_attempt_at: 1_793_836_860_000,
				last_error: '"Mollie is down"',
			}]);
	});

	test('rethrows an error raised before any row was claimed', async () => {
		vi.spyOn(database, 'transaction')
			.mockRejectedValue(new Error('connection lost'));

		await expect(runSyncBatch({
			database,
			enabledProviders: new Map(),
			createAccessService: vi.fn(),
			logger: { warn: vi.fn() },
		})).rejects.toThrow(new Error('connection lost'));
	});

	test('stops after 50 rows in one batch', async () => {
		await database('subscription_sync_queue').insert(Array.from(
			{ length: 51 },
			(_, rowIndex) => {
				return {
					provider: 'stripe',
					resource_id: `sub_${rowIndex}`,
					pending: true,
					attempts: 0,
					next_attempt_at: new Date('2026-11-04T00:00:00Z'),
					last_error: null,
				};
			},
		));

		expect(await runSyncBatch({
			database,
			enabledProviders: new Map(),
			createAccessService: vi.fn(),
			logger: { warn: vi.fn() },
		})).toBe(50);

		expect(await database('subscription_sync_queue')
			.where('attempts', 0)
			.count({ untouchedCount: '*' }))
			.toEqual([{ untouchedCount: 1 }]);
	});
});
