import { InvalidPayloadError } from '@directus/errors';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import {
	refusePlanArchiveByUpdate,
	refusePlanDelete,
	refuseSubscriptionEventWrite,
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

describe('refusePlanArchiveByUpdate', () => {
	test('refuses an update archiving a plan', () => {
		expect(() => {
			refusePlanArchiveByUpdate([
				{ data: { name: 'Monthly' }, keys: [1] },
				{ data: { status: 'archived' }, keys: [2] },
			]);
		}).toThrow(new InvalidPayloadError({
			reason: 'A plan is archived through'
				+ ' "POST /subscriptions/plans/:id/archive"',
		}));
	});

	test('passes any other update', () => {
		expect(refusePlanArchiveByUpdate([
			{ data: { status: 'subscriptions-locked' }, keys: [1] },
		])).toEqual([{ data: { status: 'subscriptions-locked' }, keys: [1] }]);
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
