import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createInvoicesTable } from '../migrations/create-invoices-table.js';
import type { SubscriptionProvider } from '../providers/types.js';
import { copySubscriptionInvoices } from './copy-subscription-invoices.js';

let database: Knex;

beforeEach(async () => {
	database = knex({
		client: 'sqlite3',
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
		pool: { min: 1, max: 1 },
	});

	await database.schema.createTable('subscriptions', (table) => {
		table.increments('id');
	});

	await database.schema.createTable('directus_collections', (table) => {
		table.string('collection');
		table.string('icon');
		table.boolean('hidden');
		table.integer('sort');
		table.string('group');
	});

	await createInvoicesTable.config.up(database);
	await database('subscriptions').insert([{ id: 1 }, { id: 2 }]);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await database.destroy();
});

describe('copySubscriptionInvoices', () => {
	test('inserts new invoices, then updates them on the next copy', async () => {
		const listInvoices = vi.fn()
			.mockResolvedValueOnce([{
				providerReference: 'in_1',
				status: 'open',
				amount: '25.00',
				currency: 'EUR',
				dateIssued: new Date('2026-11-23T10:00:00Z'),
				datePaid: null,
				hostedUrl: 'https://invoice.stripe.com/i/in_1',
				pdfUrl: null,
			}])
			.mockResolvedValueOnce([{
				providerReference: 'in_1',
				status: 'paid',
				amount: '25.00',
				currency: 'EUR',
				dateIssued: new Date('2026-11-23T10:00:00Z'),
				datePaid: new Date('2026-11-23T10:01:00Z'),
				hostedUrl: 'https://invoice.stripe.com/i/in_1',
				pdfUrl: 'https://pay.stripe.com/invoice/in_1/pdf',
			}]);

		const logger = { warn: vi.fn() };

		await copySubscriptionInvoices({
			database,
			subscriptionProvider: { listInvoices } as unknown as SubscriptionProvider,
			providerName: 'stripe',
			resourceId: 'sub_1',
			subscriptionId: 1,
			copiedAt: new Date('2026-11-23T10:00:30Z'),
			logger,
		});

		// A second row naming the same invoice keeps it where it was copied first.
		await copySubscriptionInvoices({
			database,
			subscriptionProvider: { listInvoices } as unknown as SubscriptionProvider,
			providerName: 'stripe',
			resourceId: 'sub_1',
			subscriptionId: 2,
			copiedAt: new Date('2026-11-23T10:02:00Z'),
			logger,
		});

		expect(listInvoices.mock.calls).toEqual([['sub_1'], ['sub_1']]);
		expect(logger.warn).not.toHaveBeenCalled();

		expect(await database('subscription_invoices')).toEqual([{
			id: 1,
			subscription: 1,
			provider: 'stripe',
			provider_reference: 'in_1',
			status: 'paid',
			amount: 25,
			currency: 'EUR',
			date_issued: 1_795_428_000_000,
			date_paid: 1_795_428_060_000,
			hosted_url: 'https://invoice.stripe.com/i/in_1',
			pdf_url: 'https://pay.stripe.com/invoice/in_1/pdf',
			date_updated: 1_795_428_120_000,
		}]);
	});

	test('writes nothing for a subscription not billed yet', async () => {
		await copySubscriptionInvoices({
			database,
			subscriptionProvider: {
				listInvoices: vi.fn().mockResolvedValue([]),
			} as unknown as SubscriptionProvider,
			providerName: 'mollie',
			resourceId: 'cst_1/sub_1',
			subscriptionId: 1,
			copiedAt: new Date('2026-11-23T10:00:00Z'),
			logger: { warn: vi.fn() },
		});

		expect(await database('subscription_invoices')).toEqual([]);
	});

	test('logs a failed listing and throws nothing', async () => {
		const logger = { warn: vi.fn() };

		await copySubscriptionInvoices({
			database,
			subscriptionProvider: {
				listInvoices: vi.fn().mockRejectedValue(new Error('Stripe is down')),
			} as unknown as SubscriptionProvider,
			providerName: 'stripe',
			resourceId: 'sub_1',
			subscriptionId: 1,
			copiedAt: new Date('2026-11-23T10:00:00Z'),
			logger,
		});

		expect(logger.warn.mock.calls).toEqual([[
			'Invoice copy of "stripe" "sub_1" failed, the next sync retries:'
			+ ' "Stripe is down"',
		]]);

		expect(await database('subscription_invoices')).toEqual([]);
	});
});
