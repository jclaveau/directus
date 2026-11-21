import { ForbiddenError } from '@directus/errors';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	addCheckoutColumns,
} from '../migrations/add-checkout-columns.js';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import { listOwnSubscriptions } from './list-own-subscriptions.js';

let database: Knex;

beforeEach(async () => {
	database = knex({
		client: 'sqlite3',
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
		pool: { min: 1, max: 1 },
	});

	await database.schema.createTable('directus_users', (table) => {
		table.uuid('id')
			.primary();

		table.string('email');
	});

	await database('directus_users').insert([
		{ id: 'user-payer', email: 'payer@example.com' },
		{ id: 'user-friend', email: 'friend@example.com' },
	]);

	await createSubscriptionTables.config.up(database);
	await addCheckoutColumns.config.up(database);

	await database('subscription_plans').insert({
		code: 'pro',
		name: 'Pro',
		policy: 'policy-1',
		amount: 10,
		currency: 'EUR',
		interval: '{"months":1}',
	});
});

afterEach(async () => {
	await database.destroy();
});

describe('listOwnSubscriptions', () => {
	test('shows a manager the price and the emails seated', async () => {
		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			status: 'active',
			current_period_end: '2099-02-01T00:00:00.000Z',
			custom_amount: 14.9,
			date_created: '2026-11-01T00:00:00.000Z',
			date_updated: '2026-11-01T00:00:00.000Z',
		});

		await database('subscription_managers')
			.insert({ subscription: 1, user: 'user-payer' });

		await database('subscription_beneficiaries').insert([
			{ subscription: 1, user: 'user-payer' },
			{ subscription: 1, user: 'user-friend' },
		]);

		expect(await listOwnSubscriptions(database, 'user-payer')).toEqual([{
			id: 1,
			plan: { code: 'pro', name: 'Pro' },
			provider: 'stripe',
			status: 'active',
			current_period_end: '2099-02-01T00:00:00.000Z',
			cancel_at_period_end: false,
			roles: ['manager', 'beneficiary'],
			amount: '14.90',
			currency: 'EUR',
			beneficiaries: ['friend@example.com', 'payer@example.com'],
		}]);
	});

	test('shows a manager the plan\'s price when sold at it', async () => {
		await database('subscriptions').insert({
			plan: 1,
			provider: 'mollie',
			status: 'canceled',
			cancel_at_period_end: true,
			date_created: '2026-11-01T00:00:00.000Z',
			date_updated: '2026-11-01T00:00:00.000Z',
		});

		await database('subscription_managers')
			.insert({ subscription: 1, user: 'user-payer' });

		expect(await listOwnSubscriptions(database, 'user-payer')).toEqual([{
			id: 1,
			plan: { code: 'pro', name: 'Pro' },
			provider: 'mollie',
			status: 'canceled',
			current_period_end: null,
			cancel_at_period_end: true,
			roles: ['manager'],
			amount: '10.00',
			currency: 'EUR',
			beneficiaries: [],
		}]);
	});

	test('shows a beneficiary no price, newest first, none unpaid', async () => {
		await database('subscriptions').insert([
			'active',
			'pending',
			'expired',
			'past_due',
		].map((subscriptionStatus) => {
			return {
				plan: 1,
				provider: 'mollie',
				status: subscriptionStatus,
				date_created: '2026-11-01T00:00:00.000Z',
				date_updated: '2026-11-01T00:00:00.000Z',
			};
		}));

		await database('subscription_beneficiaries').insert([1, 2, 3, 4]
			.map((subscriptionId) => {
				return { subscription: subscriptionId, user: 'user-friend' };
			}));

		expect(await listOwnSubscriptions(database, 'user-friend')).toEqual([
			{
				id: 4,
				plan: { code: 'pro', name: 'Pro' },
				provider: 'mollie',
				status: 'past_due',
				current_period_end: null,
				cancel_at_period_end: false,
				roles: ['beneficiary'],
			},
			{
				id: 1,
				plan: { code: 'pro', name: 'Pro' },
				provider: 'mollie',
				status: 'active',
				current_period_end: null,
				cancel_at_period_end: false,
				roles: ['beneficiary'],
			},
		]);
	});

	test('lists nothing for a user with no subscription', async () => {
		expect(await listOwnSubscriptions(database, 'user-friend')).toEqual([]);
	});

	test('refuses the public', async () => {
		await expect(listOwnSubscriptions(database, null))
			.rejects
			.toThrow(new ForbiddenError());
	});
});
