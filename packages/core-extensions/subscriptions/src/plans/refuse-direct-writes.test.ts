import { InvalidPayloadError } from '@directus/errors';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import {
	refuseBeneficiaryMove,
	refuseFrozenPlanUpdate,
	refuseLastManagerDelete,
	refuseLastManagerMove,
	refusePlanDelete,
	refusePlanStatusUpdate,
	refuseSubscriptionEventWrite,
	refuseSubscriptionStateUpdate,
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
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
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
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
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
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
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
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
		});

		await expect(refusePlanStatusUpdate(
			[{ data: { status: 'subscriptions-locked' }, keys: [1] }],
			database,
		)).resolves.toEqual([
			{ data: { status: 'subscriptions-locked' }, keys: [1] },
		]);
	});
});

describe('refuseFrozenPlanUpdate', () => {
	beforeEach(async () => {
		await database('subscription_plans').insert([
			{
				code: 'monthly',
				name: 'Monthly',
				policy: 'policy-1',
				amount: 10,
				currency: 'EUR',
				interval: '{"months":1}',
			},
			{
				code: 'yearly',
				name: 'Yearly',
				policy: 'policy-1',
				amount: 100,
				currency: 'EUR',
				interval: '{"months":12}',
			},
		]);

		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			status: 'pending',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});
	});

	test.each([
		[{ amount: 12 }],
		[{ currency: 'USD' }],
		[{ interval: { months: 2 } }],
		[{ beneficiaries_max: 3 }],
		[{ name: 'Monthly', amount: '10.01' }],
		[{ interval: 'monthly' }],
	])('refuses changing %j of a subscribed plan', async (planData) => {
		await expect(refuseFrozenPlanUpdate(
			[{ data: planData, keys: [2, 1] }],
			database,
		)).rejects.toThrow(new InvalidPayloadError({
			reason: 'Plan "monthly" has subscriptions: create a new plan to change'
				+ ' its amount, currency, interval or beneficiaries_max',
		}));
	});

	test('passes the values the subscribed plan already holds', async () => {
		await expect(refuseFrozenPlanUpdate(
			[
				{
					data: {
						name: 'Monthly plan',
						amount: '10.00',
						currency: 'EUR',
						interval: '{"months":1}',
						beneficiaries_max: 1,
					},
					keys: [1],
				},
				{ data: { interval: { months: 1 } }, keys: [1] },
			],
			database,
		)).resolves.toEqual([
			{
				data: {
					name: 'Monthly plan',
					amount: '10.00',
					currency: 'EUR',
					interval: '{"months":1}',
					beneficiaries_max: 1,
				},
				keys: [1],
			},
			{ data: { interval: { months: 1 } }, keys: [1] },
		]);
	});

	test('passes an interval holding the same parts in another order', async () => {
		await database('subscription_plans')
			.where('id', 1)
			.update({ interval: '{"months":1,"days":3}' });

		await expect(refuseFrozenPlanUpdate(
			[{ data: { interval: { days: 3, months: 1 } }, keys: [1] }],
			database,
		)).resolves.toEqual([
			{ data: { interval: { days: 3, months: 1 } }, keys: [1] },
		]);
	});

	test('passes a new price of a plan no subscription uses', async () => {
		await expect(refuseFrozenPlanUpdate(
			[{ data: { amount: 120 }, keys: [2] }],
			database,
		)).resolves.toEqual([{ data: { amount: 120 }, keys: [2] }]);
	});

	test('passes a rename of a subscribed plan', async () => {
		await expect(refuseFrozenPlanUpdate(
			[{ data: { name: 'Renamed' }, keys: [1] }],
			database,
		)).resolves.toEqual([{ data: { name: 'Renamed' }, keys: [1] }]);
	});
});

describe('refuseLastManagerDelete', () => {
	beforeEach(async () => {
		await database('subscription_managers').insert([
			{ subscription: 1, user: 'user-1' },
			{ subscription: 1, user: 'user-2' },
			{ subscription: 2, user: 'user-1' },
		]);
	});

	test.each([[[1]], [[2]], [[]]])('passes the delete of %j', async (
		managerKeys,
	) => {
		await expect(refuseLastManagerDelete(managerKeys, database))
			.resolves.toEqual(managerKeys);
	});

	test.each([
		[[1, 2], 'Subscription 1 needs at least 1 manager'],
		[[1, 3], 'Subscription 2 needs at least 1 manager'],
	])('refuses the delete of %j', async (managerKeys, refusalReason) => {
		await expect(refuseLastManagerDelete(managerKeys, database))
			.rejects.toThrow(new InvalidPayloadError({ reason: refusalReason }));
	});
});

describe('refuseLastManagerMove', () => {
	beforeEach(async () => {
		await database('subscription_managers').insert([
			{ subscription: 1, user: 'user-1' },
			{ subscription: 1, user: 'user-2' },
			{ subscription: 2, user: 'user-1' },
		]);
	});

	test.each([
		[{ data: { subscription: 2 }, keys: [1] }],
		[{ data: { subscription: 2 }, keys: [3] }],
		[{ data: { user: 'user-3' }, keys: [3] }],
		[{ key: 3 }],
	])('passes %j', async (updateEntry) => {
		await expect(refuseLastManagerMove([updateEntry], database))
			.resolves.toEqual([updateEntry]);
	});

	test('refuses moving the last manager away', async () => {
		await expect(refuseLastManagerMove(
			[{ data: { subscription: 1 }, keys: [3] }],
			database,
		)).rejects.toThrow(new InvalidPayloadError({
			reason: 'Subscription 2 needs at least 1 manager',
		}));
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

	test.each([
		[{ plan: 2 }],
		[{ continues: 3 }],
	])('refuses writing %j', (subscriptionData) => {
		expect(() => {
			refuseSubscriptionStateUpdate([{ data: subscriptionData, keys: [1] }]);
		}).toThrow(new InvalidPayloadError({
			reason: '"plan" and "continues" of a subscription follow its provider',
		}));
	});

	test('passes any other field', () => {
		expect(refuseSubscriptionStateUpdate([
			{ data: { user_updated: 'user-1' }, keys: [1] },
		])).toEqual([{ data: { user_updated: 'user-1' }, keys: [1] }]);
	});
});

describe('refuseBeneficiaryMove', () => {
	beforeEach(async () => {
		await database('subscription_beneficiaries').insert([
			{ subscription: 1, user: 'user-1' },
			{ subscription: 1, user: null },
		]);
	});

	test.each([
		[{ data: { user: 'user-2' }, keys: [1] }],
		[{ data: { user: null }, keys: [1] }],
		[{ data: { user: 'user-2' }, keys: [2] }],
	])('refuses moving the user: %j', async (updateEntry) => {
		await expect(refuseBeneficiaryMove([updateEntry], database))
			.rejects.toThrow(new InvalidPayloadError({
				reason: 'A beneficiary\'s "user" cannot change: delete the'
					+ ' beneficiary and add the new one',
			}));
	});

	test('refuses moving the subscription', async () => {
		await expect(refuseBeneficiaryMove(
			[{ data: { subscription: 2 }, keys: [1] }],
			database,
		)).rejects.toThrow(new InvalidPayloadError({
			reason: 'A beneficiary\'s "subscription" cannot change: delete the'
				+ ' beneficiary and add the new one',
		}));
	});

	test.each([
		[{ data: { user: 'user-1', subscription: 1 }, keys: [1] }],
		[{ data: { user: null }, keys: [2] }],
		[{ data: { user_updated: 'user-1' }, keys: [1] }],
		[{ key: 1 }],
	])('passes %j', async (updateEntry) => {
		await expect(refuseBeneficiaryMove([updateEntry], database))
			.resolves.toEqual([updateEntry]);
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
