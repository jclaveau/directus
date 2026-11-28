import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import knex, { type Knex } from 'knex';
import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import { BeneficiariesMaxReachedError } from '../errors.js';
import { createInvitesTable } from '../migrations/create-invites-table.js';
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

	await database.schema.createTable('directus_users', (table) => {
		table.uuid('id');
		table.string('email');
		table.string('status');
	});

	await database('directus_users').insert({
		id: '6f9619ff-8b86-d011-b42d-00c04fc964ff',
		email: 'known-1@example.com',
		status: 'active',
	});

	await createSubscriptionTables.config.up(database);
	await createInvitesTable.config.up(database);
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
			inviteUser: vi.fn(),
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
			inviteUser: vi.fn(),
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
			inviteUser: vi.fn(),
		})).rejects.toThrow(new ForbiddenError());

		expect(await database('subscription_beneficiaries').count({ seats: '*' }))
			.toEqual([{ seats: 1 }]);
	});

	test('refuses seating a user that does not exist', async () => {
		await database('subscriptions').insert({
			plan: 1,
			provider: 'stripe',
			status: 'pending',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_managers')
			.insert({ subscription: 1, user: 'user-1' });

		await expect(addOwnBeneficiary({
			database,
			enabledProviders: new Map(),
			userId: 'user-1',
			requestBody: {
				subscription: 1,
				user: '00000000-0000-0000-0000-000000000000',
			},
			inviteUser: vi.fn(),
		})).rejects.toThrow(new InvalidPayloadError({
			reason: 'User "00000000-0000-0000-0000-000000000000" does not exist',
		}));

		expect(await database('subscription_beneficiaries')).toEqual([]);
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
		[{ subscription: 1 }, 'A beneficiary is named by "user" or by "email"'],
		[
			{ subscription: 1, user: null },
			'"user" must be a user id, got null',
		],
		[
			{
				subscription: 1,
				user: '6f9619ff-8b86-d011-b42d-00c04fc964ff',
				email: 'known-1@example.com',
			},
			'A beneficiary is named by "user" or by "email", not both',
		],
		[
			{ subscription: 1, email: 'not-an-email' },
			'"email" must be an email, got "not-an-email"',
		],
		[{ subscription: 1, email: 15 }, '"email" must be an email, got 15'],
		[
			{ subscription: 1, email: 'ada@example..com' },
			'"email" must be an email, got "ada@example..com"',
		],
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
			inviteUser: vi.fn(),
		})).rejects.toThrow(new InvalidPayloadError({ reason: refusalReason }));
	});

	test.each([
		['Known-1@Example.com', 'known-1@example.com', 'active'],
		['invited-1@example.com', 'invited-1@example.com', 'invited'],
	])('seats the user of the email %j, sending no mail', async (
		seatedEmail,
		storedEmail,
		storedStatus,
	) => {
		const inviteUser = vi.fn();

		await database('directus_users')
			.where('id', '6f9619ff-8b86-d011-b42d-00c04fc964ff')
			.update({ email: storedEmail, status: storedStatus });

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
			requestBody: { subscription: 1, email: seatedEmail },
			inviteUser,
		})).toBe(1);

		expect(await database('subscription_beneficiaries').select('user'))
			.toEqual([{ user: '6f9619ff-8b86-d011-b42d-00c04fc964ff' }]);

		expect(await database('subscription_invites')).toEqual([]);
		expect(inviteUser).not.toHaveBeenCalled();
	});

	test('invites the user of an unknown email once its seat is taken', async () => {
		const inviteUser = vi.fn();

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
			requestBody: { subscription: 1, email: 'New-1@Example.com' },
			inviteUser,
		})).toBe(1);

		const [invitedUser] = await database('directus_users')
			.select('id', 'email', 'status')
			.where('email', 'new-1@example.com');

		expect(invitedUser).toEqual({
			id: expect.stringMatching(/^[\da-f-]{36}$/),
			email: 'new-1@example.com',
			status: 'invited',
		});

		expect(await database('subscription_beneficiaries').select('user'))
			.toEqual([{ user: invitedUser.id }]);

		expect(await database('subscription_invites').select('user', 'date_sent'))
			.toEqual([{ user: invitedUser.id, date_sent: 1_793_836_800_000 }]);

		expect(inviteUser).toHaveBeenCalledWith('new-1@example.com');
	});

	test('creates no user nor mail for an email the full plan refuses', async () => {
		const inviteUser = vi.fn();

		await database('subscription_plans')
			.where('id', 1)
			.update({ beneficiaries_max: 1 });

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
			.insert({ subscription: 1, user: 'user-1' });

		await expect(addOwnBeneficiary({
			database,
			enabledProviders: new Map(),
			userId: 'user-1',
			requestBody: { subscription: 1, email: 'second-1@example.com' },
			inviteUser,
		})).rejects.toThrow(new BeneficiariesMaxReachedError({
			planCode: 'family',
			beneficiariesMax: 1,
		}));

		expect(await database('directus_users').pluck('email'))
			.toEqual(['known-1@example.com']);

		expect(await database('subscription_invites')).toEqual([]);
		expect(inviteUser).not.toHaveBeenCalled();
	});
});
