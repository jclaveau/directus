import { InvalidPayloadError } from '@directus/errors';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import {
	refusePlanDelete,
	refusePlanStatusUpdate,
	refuseSubscriptionEventWrite,
	refuseSubscriptionStateUpdate,
	refuseUsedReferenceUpdate,
} from './refuse-direct-writes.js';

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
	await database.destroy();
});

describe('refusePlanDelete', () => {
	test('refuses a plan, naming it', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 990,
			currency: 'EUR',
			interval: 'month',
		});

		await expect(refusePlanDelete([1], database)).rejects.toThrow(
			new InvalidPayloadError({
				reason: 'Plan "monthly" cannot be deleted, archive it instead',
			}),
		);
	});

	test('passes keys no plan holds to the delete, which refuses them', async () => {
		await expect(refusePlanDelete([9], database)).resolves.toEqual([9]);
	});
});

describe('refusePlanStatusUpdate', () => {
	test('refuses an update archiving a plan', async () => {
		await expect(refusePlanStatusUpdate([
			{ data: { name: 'Monthly' }, keys: [1] },
			{ data: { status: 'archived' }, keys: [2] },
		], database)).rejects.toThrow(new InvalidPayloadError({
			reason: 'A plan is archived through'
				+ ' "POST /subscriptions/plans/:id/archive"',
		}));
	});

	test('refuses changing the status of an archived plan', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 990,
			currency: 'EUR',
			interval: 'month',
			status: 'archived',
		});

		await expect(refusePlanStatusUpdate(
			[{ data: { status: 'active' }, keys: [1] }],
			database,
		)).rejects.toThrow(new InvalidPayloadError({
			reason: 'Plan "monthly" is archived, its status cannot change',
		}));
	});

	test('passes any other update of an archived plan', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 990,
			currency: 'EUR',
			interval: 'month',
			status: 'archived',
		});

		await expect(refusePlanStatusUpdate(
			[{ data: { name: 'Old monthly' }, keys: [1] }],
			database,
		)).resolves.toEqual([{ data: { name: 'Old monthly' }, keys: [1] }]);
	});

	test('passes a status change of a plan not archived', async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 990,
			currency: 'EUR',
			interval: 'month',
		});

		await expect(refusePlanStatusUpdate(
			[{ data: { status: 'subscriptions-locked' }, keys: [1] }],
			database,
		)).resolves.toEqual([
			{ data: { status: 'subscriptions-locked' }, keys: [1] },
		]);
	});
});

describe('refuseUsedReferenceUpdate', () => {
	beforeEach(async () => {
		await database('subscription_plans').insert({
			code: 'monthly',
			name: 'Monthly',
			policy: 'policy-1',
			amount: 990,
			currency: 'EUR',
			interval: 'month',
		});

		await database('subscription_plan_references').insert([
			{ plan: 1, provider: 'stripe', reference: 'price_used' },
			{ plan: 1, provider: 'mollie', reference: 'price_unused' },
		]);

		await database('subscribers').insert({ user: 'user-1' });

		await database('subscriber_customers')
			.insert({ subscriber: 1, provider: 'stripe', provider_customer_id: 'cus_1' });

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
	});

	test.each([
		[{ reference: 'price_other' }],
		[{ provider: 'mollie' }],
		[{ plan: 2 }],
	])('refuses changing %j of a used reference', async (referenceData) => {
		await expect(refuseUsedReferenceUpdate(
			[{ data: referenceData, keys: [1] }],
			database,
		)).rejects.toThrow(new InvalidPayloadError({
			reason: 'Plan reference "price_used" is used by a subscription,'
				+ ' it cannot change',
		}));
	});

	test('passes a reference no subscription uses', async () => {
		await expect(refuseUsedReferenceUpdate(
			[{ data: { reference: 'price_typo' }, keys: [2] }],
			database,
		)).resolves.toEqual([{ data: { reference: 'price_typo' }, keys: [2] }]);
	});
});

describe('refuseSubscriptionStateUpdate', () => {
	test.each([
		[{ status: 'canceled' }],
		[{ cancel_at_period_end: true }],
	])('refuses writing %j', (subscriptionData) => {
		expect(() => {
			refuseSubscriptionStateUpdate([{ data: subscriptionData, keys: [1] }]);
		}).toThrow(new InvalidPayloadError({
			reason: '"status" and "cancel_at_period_end" of a subscription follow'
				+ ' its provider',
		}));
	});

	test('passes any other field', () => {
		expect(refuseSubscriptionStateUpdate([
			{ data: { user_updated: 'user-1' }, keys: [1] },
		])).toEqual([{ data: { user_updated: 'user-1' }, keys: [1] }]);
	});
});

describe('refuseSubscriptionEventWrite', () => {
	test('refuses any write', () => {
		expect(() => {
			refuseSubscriptionEventWrite();
		}).toThrow(new InvalidPayloadError({
			reason: '"subscription_events" only records what the subscriptions'
				+ ' bundle did',
		}));
	});
});
