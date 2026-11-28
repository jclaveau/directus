import { oneLine } from '@directus/utils';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	UnknownProviderError,
	WebhookIgnoredError,
	WebhookRefusedError,
	WebhookUnreadableError,
} from '../errors.js';
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
			logger: { warn: vi.fn(), error: vi.fn() },
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
			logger: { warn: vi.fn(), error: vi.fn() },
		})).rejects.toThrow(new UnknownProviderError({ provider: 'paypal' }));
	});

	test('logs an ignored webhook and queues nothing', async () => {
		const warn = vi.fn();

		const verifyWebhook = vi.fn().mockRejectedValue(new WebhookIgnoredError({
			provider: 'stripe',
			reason: 'event type "charge.succeeded" is not handled',
		}));

		await receiveWebhook({
			database,
			enabledProviders: new Map([
				['stripe', { verifyWebhook } as unknown as SubscriptionProvider],
			]),
			providerName: 'stripe',
			rawBody: Buffer.from('{}'),
			requestHeaders: {},
			logger: { warn, error: vi.fn() },
		});

		expect(warn).toHaveBeenCalledWith(
			'Webhook from "stripe" ignored: event type "charge.succeeded" is not handled',
		);

		expect(await database('subscription_sync_queue')).toEqual([]);
	});

	test(oneLine`
		logs and keeps a signed webhook it cannot read, queues nothing
	`, async () => {
		vi.useFakeTimers({ now: new Date('2026-11-05T00:00:00Z'), toFake: ['Date'] });
		const error = vi.fn();

		const verifyWebhook = vi.fn().mockRejectedValue(new WebhookUnreadableError({
			provider: 'mollie',
			reason: 'the body is not JSON',
		}));

		await receiveWebhook({
			database,
			enabledProviders: new Map([
				['mollie', { verifyWebhook } as unknown as SubscriptionProvider],
			]),
			providerName: 'mollie',
			rawBody: Buffer.from('id=tr_1'),
			requestHeaders: {},
			logger: { warn: vi.fn(), error },
		});

		expect(error).toHaveBeenCalledWith(
			'Webhook from "mollie" unreadable: the body is not JSON',
		);

		expect(await database('subscription_events')).toEqual([{
			id: 1,
			subscription: null,
			status: null,
			current_period_end: null,
			cancel_at_period_end: null,
			source: 'webhook_unreadable',
			user: null,
			date_created: 1_793_836_800_000,
			payload: 'id=tr_1',
		}]);

		expect(await database('subscription_sync_queue')).toEqual([]);
	});

	test('refuses a webhook failing its signature', async () => {
		const refusedWebhook = new WebhookRefusedError({
			provider: 'stripe',
			reason: 'bad signature',
		});

		await expect(receiveWebhook({
			database,
			enabledProviders: new Map([
				['stripe', {
					verifyWebhook: vi.fn().mockRejectedValue(refusedWebhook),
				} as unknown as SubscriptionProvider],
			]),
			providerName: 'stripe',
			rawBody: Buffer.from('{}'),
			requestHeaders: {},
			logger: { warn: vi.fn(), error: vi.fn() },
		})).rejects.toThrow(refusedWebhook);
	});
});
