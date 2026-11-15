import { InvalidPayloadError } from '@directus/errors';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { BeneficiariesMaxReachedError } from '../errors.js';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import { addBeneficiary } from './add-beneficiary.js';

let database: Knex;

beforeEach(async () => {
	database = knex({
		client: 'sqlite3',
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
		pool: { min: 1, max: 1 },
	});

	await createSubscriptionTables.config.up(database);

	await database('subscription_plans').insert({
		code: 'family',
		name: 'Family',
		policy: 'policy-1',
		amount: 10,
		currency: 'EUR',
		interval: '{"months":1}',
		beneficiaries_max: 2,
	});

	await database('subscriptions').insert({
		plan: 1,
		provider: 'stripe',
		status: 'pending',
		date_created: new Date('2026-10-01T00:00:00Z'),
		date_updated: new Date('2026-10-01T00:00:00Z'),
	});
});

afterEach(async () => {
	await database.destroy();
});

describe('addBeneficiary', () => {
	test('seats a user without an access yet', async () => {
		await database('subscription_beneficiaries')
			.insert({ subscription: 1, user: 'user-1', access: 'access-1' });

		expect(await addBeneficiary(
			database,
			{ subscription: 1, user: 'user-2' },
		)).toBe(2);

		expect(await database('subscription_beneficiaries')).toEqual([
			{ id: 1, subscription: 1, user: 'user-1', access: 'access-1' },
			{ id: 2, subscription: 1, user: 'user-2', access: null },
		]);
	});

	test('refuses a subscription that does not exist', async () => {
		await expect(addBeneficiary(
			database,
			{ subscription: 9, user: 'user-1' },
		)).rejects.toThrow(new InvalidPayloadError({
			reason: 'Subscription 9 does not exist',
		}));
	});

	test('refuses a user already seated', async () => {
		await database('subscription_beneficiaries')
			.insert({ subscription: 1, user: 'user-1', access: null });

		await expect(addBeneficiary(
			database,
			{ subscription: 1, user: 'user-1' },
		)).rejects.toThrow(new InvalidPayloadError({
			reason: 'User "user-1" already benefits from subscription 1',
		}));
	});

	test('refuses a seat past the plan\'s beneficiaries_max', async () => {
		await database('subscription_beneficiaries').insert([
			{ subscription: 1, user: 'user-1', access: null },
			{ subscription: 1, user: null, access: null },
		]);

		await expect(addBeneficiary(
			database,
			{ subscription: 1, user: 'user-3' },
		)).rejects.toThrow(new BeneficiariesMaxReachedError({
			planCode: 'family',
			beneficiariesMax: 2,
		}));

		expect(await database('subscription_beneficiaries').count({ seats: '*' }))
			.toEqual([{ seats: 2 }]);
	});
});
