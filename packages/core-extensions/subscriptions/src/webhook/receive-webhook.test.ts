import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { UnknownProviderError } from '../errors.js';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import type { SubscriptionProvider } from '../providers/types.js';
import { receiveWebhook } from './receive-webhook.js';

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

describe('receiveWebhook', () => {
	test('queues the sync of the resource the webhook names', async () => {
		vi.useFakeTimers({ now: new Date('2026-11-05T00:00:00Z'), toFake: ['Date'] });
		const verifyWebhook = vi.fn().mockResolvedValue('cst_1/sub_1');

		await receiveWebhook({
			database,
			enabledProviders: new Map([
				['mollie', { verifyWebhook } as unknown as SubscriptionProvider],
			]),
			providerName: 'mollie',
			rawBody: Buffer.from('id=tr_1'),
			requestHeaders: { 'content-type': 'application/x-www-form-urlencoded' },
		});

		expect(verifyWebhook).toHaveBeenCalledWith(
			Buffer.from('id=tr_1'),
			{ 'content-type': 'application/x-www-form-urlencoded' },
		);

		expect(await database('subscription_sync_queue')
			.select('provider', 'resource_id', 'pending', 'next_attempt_at'))
			.toEqual([{
				provider: 'mollie',
				resource_id: 'cst_1/sub_1',
				pending: 1,
				next_attempt_at: 1_793_836_800_000,
			}]);
	});

	test('refuses a webhook of a disabled provider', async () => {
		await expect(receiveWebhook({
			database,
			enabledProviders: new Map(),
			providerName: 'paypal',
			rawBody: Buffer.from('{}'),
			requestHeaders: {},
		})).rejects.toThrow(new UnknownProviderError({ provider: 'paypal' }));
	});
});
