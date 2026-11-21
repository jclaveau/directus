import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import {
	revokeDeletedBeneficiaryAccesses,
} from './revoke-deleted-beneficiary-accesses.js';

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

	await database('subscriptions').insert([
		{
			plan: 1,
			provider: 'mollie',
			status: 'canceled',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		},
		{
			plan: 1,
			provider: 'mollie',
			status: 'active',
			continues: 1,
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		},
	]);
});

afterEach(async () => {
	await database.destroy();
});

describe('revokeDeletedBeneficiaryAccesses', () => {
	test('revokes the access of a deleted beneficiary', async () => {
		await database('subscription_beneficiaries').insert([
			{ subscription: 1, user: 'user-1', access: 'access-1' },
			{ subscription: 1, user: 'user-2', access: 'access-2' },
		]);

		const accessService = { deleteOne: vi.fn() };

		await revokeDeletedBeneficiaryAccesses({
			trx: database,
			accessService: accessService as never,
			beneficiaryKeys: [1],
		});

		expect(accessService.deleteOne.mock.calls).toEqual([['access-1']]);
	});

	test('keeps an access a resumed subscription still shares', async () => {
		await database('subscription_beneficiaries').insert([
			{ subscription: 1, user: 'user-1', access: 'access-1' },
			{ subscription: 2, user: 'user-1', access: 'access-1' },
		]);

		const accessService = { deleteOne: vi.fn() };

		await revokeDeletedBeneficiaryAccesses({
			trx: database,
			accessService: accessService as never,
			beneficiaryKeys: [1],
		});

		expect(accessService.deleteOne.mock.calls).toEqual([]);
	});

	test('revokes once an access every deleted row shared', async () => {
		await database('subscription_beneficiaries').insert([
			{ subscription: 1, user: 'user-1', access: 'access-1' },
			{ subscription: 2, user: 'user-1', access: 'access-1' },
		]);

		const accessService = { deleteOne: vi.fn() };

		await revokeDeletedBeneficiaryAccesses({
			trx: database,
			accessService: accessService as never,
			beneficiaryKeys: [1, 2],
		});

		expect(accessService.deleteOne.mock.calls).toEqual([['access-1']]);
	});

	test('revokes nothing for a beneficiary without access', async () => {
		await database('subscription_beneficiaries').insert([
			{ subscription: 1, user: 'user-1', access: null },
		]);

		const accessService = { deleteOne: vi.fn() };

		await revokeDeletedBeneficiaryAccesses({
			trx: database,
			accessService: accessService as never,
			beneficiaryKeys: [1],
		});

		expect(accessService.deleteOne.mock.calls).toEqual([]);
	});
});
