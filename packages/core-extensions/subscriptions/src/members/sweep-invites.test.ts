import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createInvitesTable } from '../migrations/create-invites-table.js';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import { sweepInvites } from './sweep-invites.js';

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

		table.string('status');
	});

	await createSubscriptionTables.config.up(database);
	await createInvitesTable.config.up(database);
	vi.useFakeTimers({ now: new Date('2026-11-22T00:00:00Z'), toFake: ['Date'] });
});

afterEach(async () => {
	vi.useRealTimers();
	await database.destroy();
});

describe('sweepInvites', () => {
	test('deletes the invitees holding no seat since 30 days', async () => {
		await database('directus_users').insert([
			{ id: 'stale', status: 'invited' },
			{ id: 'seated', status: 'invited' },
			{ id: 'fresh', status: 'invited' },
			{ id: 'joined', status: 'active' },
			{ id: 'edge', status: 'invited' },
		]);

		await database('subscription_plans').insert({
			code: 'family',
			name: 'Family',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
			beneficiaries_max: 3,
		});

		await database('subscriptions').insert({
			plan: 1,
			provider: 'mollie',
			status: 'pending',
			date_created: new Date('2026-10-01T00:00:00Z'),
			date_updated: new Date('2026-10-01T00:00:00Z'),
		});

		await database('subscription_beneficiaries')
			.insert({ subscription: 1, user: 'seated' });

		await database('subscription_invites').insert([
			{ user: 'stale', date_sent: new Date('2026-10-22T23:59:59Z') },
			{ user: 'seated', date_sent: new Date('2026-01-01T00:00:00Z') },
			{ user: 'fresh', date_sent: new Date('2026-11-21T00:00:00Z') },
			{ user: 'joined', date_sent: new Date('2026-01-01T00:00:00Z') },
			{ user: 'edge', date_sent: new Date('2026-10-23T00:00:00Z') },
		]);

		expect(await sweepInvites(database)).toBe(1);

		const keptIds = await database('directus_users')
			.orderBy('id')
			.pluck('id');

		expect(keptIds).toEqual(['edge', 'fresh', 'joined', 'seated']);
	});

	test('deletes nothing when no invitee is due', async () => {
		await database('directus_users').insert({ id: 'fresh', status: 'invited' });

		await database('subscription_invites')
			.insert({ user: 'fresh', date_sent: new Date('2026-11-21T00:00:00Z') });

		expect(await sweepInvites(database)).toBe(0);
		expect(await database('directus_users').pluck('id')).toEqual(['fresh']);
	});
});
