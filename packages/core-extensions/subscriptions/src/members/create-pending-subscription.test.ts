import { InvalidPayloadError } from '@directus/errors';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import {
	createPendingSubscription,
	readInsertedId,
} from './create-pending-subscription.js';

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
});

afterEach(async () => {
	vi.useRealTimers();
	await database.destroy();
});

describe('createPendingSubscription', () => {
	test('stores a pending row of an active plan', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		expect(await createPendingSubscription(
			database,
			{ plan: 1, provider: 'stripe' },
		)).toBe(1);

		expect(await database('subscriptions')).toEqual([{
			id: 1,
			plan: 1,
			continues: null,
			provider: 'stripe',
			provider_customer_id: null,
			provider_subscription_id: null,
			status: 'pending',
			current_period_end: null,
			cancel_at_period_end: 0,
			user_updated: null,
			date_created: 1_793_836_800_000,
			date_updated: 1_793_836_800_000,
		}]);
	});

	test('refuses a plan that does not exist', async () => {
		await expect(createPendingSubscription(
			database,
			{ plan: 9, provider: 'stripe' },
		)).rejects.toThrow(new InvalidPayloadError({
			reason: 'Plan 9 does not exist',
		}));
	});

	test.each(['subscriptions-locked', 'archived'])(
		'refuses a %s plan',
		async (planStatus) => {
			await database('subscription_plans').insert({
				code: 'monthly',
				name: 'Monthly',
				policy: 'policy-1',
				amount: 10,
				currency: 'EUR',
				interval: '{"months":1}',
				status: planStatus,
			});

			await expect(createPendingSubscription(
				database,
				{ plan: 1, provider: 'stripe' },
			)).rejects.toThrow(new InvalidPayloadError({
				reason: `Plan "monthly" is "${planStatus}",`
					+ ' it sells no new subscription',
			}));

			expect(await database('subscriptions')).toEqual([]);
		},
	);
});

describe('readInsertedId', () => {
	test.each([
		[{ id: 3 }, 3],
		[3, 3],
	])('reads %j as %j', (insertedRow, expectedId) => {
		expect(readInsertedId(insertedRow)).toBe(expectedId);
	});
});
