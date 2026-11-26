import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { addCheckoutColumns } from '../migrations/add-checkout-columns.js';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import type { SubscriptionProvider } from '../providers/types.js';
import { confirmOwnCheckout } from './confirm-own-checkout.js';

let database: Knex;

beforeEach(async () => {
	database = knex({
		client: 'sqlite3',
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
		pool: { min: 1, max: 1 },
	});

	await database.schema.createTable('directus_users', (table) => {
		table.uuid('id').primary();
	});

	await database('directus_users').insert([{ id: 'user-1' }, { id: 'user-2' }]);
	await createSubscriptionTables.config.up(database);
	await addCheckoutColumns.config.up(database);

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
			payer: 'user-1',
			provider: 'mollie',
			provider_customer_id: 'cst_1',
			status: 'pending',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		},
		{
			plan: 1,
			payer: 'user-1',
			provider: 'mollie',
			provider_customer_id: 'cst_2',
			provider_subscription_id: 'sub_2',
			status: 'active',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		},
	]);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await database.destroy();
});

describe('confirmOwnCheckout', () => {
	test('queues the paid payment of the user\'s pending checkout', async () => {
		const findCheckoutPayment = vi.fn().mockResolvedValue('tr_1');

		await expect(confirmOwnCheckout({
			database,
			enabledProviders: new Map([
				['mollie', { findCheckoutPayment } as unknown as SubscriptionProvider],
			]),
			userId: 'user-1',
			subscriptionId: 1,
		})).resolves.toEqual({
			subscription: 1,
			status: 'pending',
			sync_queued: true,
		});

		expect(findCheckoutPayment)
			.toHaveBeenCalledWith({ customerId: 'cst_1', directusSubscription: 1 });

		expect(await database('subscription_sync_queue')
			.select('provider', 'resource_id'))
			.toEqual([{ provider: 'mollie', resource_id: 'tr_1' }]);
	});

	test('queues nothing while the checkout is unpaid', async () => {
		await expect(confirmOwnCheckout({
			database,
			enabledProviders: new Map([
				['mollie', {
					findCheckoutPayment: vi.fn().mockResolvedValue(null),
				} as unknown as SubscriptionProvider],
			]),
			userId: 'user-1',
			subscriptionId: 1,
		})).resolves.toEqual({
			subscription: 1,
			status: 'pending',
			sync_queued: false,
		});

		expect(await database('subscription_sync_queue').select('id'))
			.toEqual([]);
	});

	test('answers a started subscription without searching', async () => {
		const findCheckoutPayment = vi.fn();

		await expect(confirmOwnCheckout({
			database,
			enabledProviders: new Map([
				['mollie', { findCheckoutPayment } as unknown as SubscriptionProvider],
			]),
			userId: 'user-1',
			subscriptionId: 2,
		})).resolves.toEqual({
			subscription: 2,
			status: 'active',
			sync_queued: false,
		});

		expect(findCheckoutPayment).not.toHaveBeenCalled();
	});

	test('refuses another payer\'s subscription', async () => {
		await expect(confirmOwnCheckout({
			database,
			enabledProviders: new Map(),
			userId: 'user-2',
			subscriptionId: 1,
		})).rejects.toThrow(new ForbiddenError());
	});

	test('refuses nobody', async () => {
		await expect(confirmOwnCheckout({
			database,
			enabledProviders: new Map(),
			userId: null,
			subscriptionId: 1,
		})).rejects.toThrow(new ForbiddenError());
	});

	test('refuses a missing subscription id', async () => {
		await expect(confirmOwnCheckout({
			database,
			enabledProviders: new Map(),
			userId: 'user-1',
			subscriptionId: undefined,
		})).rejects.toThrow(new InvalidPayloadError({
			reason: '"subscription" is required',
		}));
	});
});
