import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import { enqueueSync, selectDueSync } from './sync-queue.js';

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
	vi.useRealTimers();
	vi.restoreAllMocks();
	await database.destroy();
});

describe('enqueueSync', () => {
	test('queues a pending sync due now', async () => {
		vi.useFakeTimers({ now: new Date('2026-11-05T00:00:00Z'), toFake: ['Date'] });

		await enqueueSync(database, { provider: 'stripe', resourceId: 'sub_1' });

		expect(await database('subscription_sync_queue')).toEqual([{
			id: 1,
			provider: 'stripe',
			resource_id: 'sub_1',
			pending: 1,
			attempts: 0,
			next_attempt_at: 1_793_836_800_000,
			last_error: null,
		}]);
	});

	test('brings a failed sync forward, keeping its history', async () => {
		vi.useFakeTimers({ now: new Date('2026-11-05T00:00:00Z'), toFake: ['Date'] });

		await database('subscription_sync_queue').insert({
			provider: 'stripe',
			resource_id: 'sub_1',
			pending: false,
			attempts: 3,
			next_attempt_at: new Date('2026-11-06T00:00:00Z'),
			last_error: 'Stripe is down',
		});

		await enqueueSync(database, { provider: 'stripe', resourceId: 'sub_1' });

		expect(await database('subscription_sync_queue')).toEqual([{
			id: 1,
			provider: 'stripe',
			resource_id: 'sub_1',
			pending: 1,
			attempts: 3,
			next_attempt_at: 1_793_836_800_000,
			last_error: 'Stripe is down',
		}]);
	});
});

describe('selectDueSync', () => {
	test('selects the longest-due pending sync', async () => {
		await database('subscription_sync_queue').insert([
			{
				provider: 'stripe',
				resource_id: 'sub_done',
				pending: false,
				next_attempt_at: new Date('2026-11-01T00:00:00Z'),
			},
			{
				provider: 'stripe',
				resource_id: 'sub_later',
				pending: true,
				next_attempt_at: new Date('2026-11-06T00:00:00Z'),
			},
			{
				provider: 'stripe',
				resource_id: 'sub_recent',
				pending: true,
				next_attempt_at: new Date('2026-11-04T00:00:00Z'),
			},
			{
				provider: 'mollie',
				resource_id: 'cst_1/sub_1',
				pending: true,
				next_attempt_at: new Date('2026-11-03T00:00:00Z'),
			},
		]);

		expect(await selectDueSync(database, new Date('2026-11-05T00:00:00Z')))
			.toEqual({
				id: 4,
				provider: 'mollie',
				resource_id: 'cst_1/sub_1',
				attempts: 0,
				next_attempt_at: 1_793_664_000_000,
			});
	});

	test('selects nothing when no sync is due', async () => {
		expect(await selectDueSync(database, new Date('2026-11-05T00:00:00Z')))
			.toBe(undefined);
	});

	test('skips rows another worker locked on postgres', () => {
		expect(selectDueSync(
			knex({ client: 'pg' }),
			new Date('2026-11-05T00:00:00Z'),
		)
			.toSQL()
			.toNative())
			.toEqual({
				sql: 'select "id", "provider", "resource_id", "attempts",'
					+ ' "next_attempt_at"'
					+ ' from "subscription_sync_queue"'
					+ ' where "pending" = $1 and "next_attempt_at" <= $2'
					+ ' order by "next_attempt_at" asc limit $3'
					+ ' for update skip locked',
				bindings: [true, new Date('2026-11-05T00:00:00Z'), 1],
			});
	});
});
