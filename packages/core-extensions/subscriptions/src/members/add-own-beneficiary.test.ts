import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import knex, { type Knex } from 'knex';
import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import { createStripeProvider } from '../providers/stripe-provider.js';
import { addOwnBeneficiary } from './add-own-beneficiary.js';

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

	await database('subscription_plans').insert({
		code: 'family',
		name: 'Family',
		policy: 'policy-1',
		amount: 10,
		currency: 'EUR',
		interval: '{"months":1}',
		beneficiaries_max: 3,
	});
});

afterEach(async () => {
	vi.useRealTimers();
	await database.destroy();
});

describe('addOwnBeneficiary', () => {
	test('seats the user and queues the sync granting the access', async () => {
		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			provider_customer_id: 'cus_1',
			provider_subscription_id: 'sub_1',
			status: 'active',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_managers')
			.insert({ subscription: 1, user: 'user-1' });

		expect(await addOwnBeneficiary({
			database,
			enabledProviders: new Map([
				['stripe', createStripeProvider(new Stripe('sk_test_1'), 'whsec_1')],
			]),
			userId: 'user-1',
			requestBody: {
				subscription: 1,
				user: '6f9619ff-8b86-d011-b42d-00c04fc964ff',
			},
		})).toBe(1);

		expect(await database('subscription_beneficiaries')).toEqual([{
			id: 1,
			subscription: 1,
			user: '6f9619ff-8b86-d011-b42d-00c04fc964ff',
			access: null,
		}]);

		expect(await database('subscription_sync_queue')
			.select('provider', 'resource_id', 'pending', 'next_attempt_at'))
			.toEqual([{
				provider: 'stripe',
				resource_id: 'sub_1',
				pending: 1,
				next_attempt_at: 1_793_836_800_000,
			}]);
	});

	test('seats the user of a pending row, queueing nothing', async () => {
		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			status: 'pending',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_managers')
			.insert({ subscription: 1, user: 'user-1' });

		expect(await addOwnBeneficiary({
			database,
			enabledProviders: new Map(),
			userId: 'user-1',
			requestBody: {
				subscription: 1,
				user: '6f9619ff-8b86-d011-b42d-00c04fc964ff',
			},
		})).toBe(1);

		expect(await database('subscription_sync_queue')).toEqual([]);
	});

	test.each([
		[null, { subscription: 1, user: '6f9619ff-8b86-d011-b42d-00c04fc964ff' }],
		['user-2', { subscription: 1, user: '6f9619ff-8b86-d011-b42d-00c04fc964ff' }],
		['user-1', { subscription: 2, user: '6f9619ff-8b86-d011-b42d-00c04fc964ff' }],
	])('refuses %j seating %j', async (userId, requestBody) => {
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
			.insert({ subscription: 1, user: 'user-2', access: null });

		await expect(addOwnBeneficiary({
			database,
			enabledProviders: new Map(),
			userId,
			requestBody,
		})).rejects.toThrow(new ForbiddenError());

		expect(await database('subscription_beneficiaries').count({ seats: '*' }))
			.toEqual([{ seats: 1 }]);
	});

	test.each([
		[
			{ user: '6f9619ff-8b86-d011-b42d-00c04fc964ff' },
			'"subscription" must be a subscription id, got null',
		],
		[
			{ subscription: '1', user: '6f9619ff-8b86-d011-b42d-00c04fc964ff' },
			'"subscription" must be a subscription id, got "1"',
		],
		[
			{ subscription: 0, user: '6f9619ff-8b86-d011-b42d-00c04fc964ff' },
			'"subscription" must be a subscription id, got 0',
		],
		[{ subscription: 1 }, '"user" must be a user id, got null'],
		[
			{ subscription: 1, user: 'user-2' },
			'"user" must be a user id, got "user-2"',
		],
		[null, '"subscription" must be a subscription id, got null'],
	])('refuses the payload %j', async (requestBody, refusalReason) => {
		await expect(addOwnBeneficiary({
			database,
			enabledProviders: new Map(),
			userId: 'user-1',
			requestBody,
		})).rejects.toThrow(new InvalidPayloadError({ reason: refusalReason }));
	});
});
