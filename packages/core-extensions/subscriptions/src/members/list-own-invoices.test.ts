import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	addCheckoutColumns,
} from '../migrations/add-checkout-columns.js';
import {
	createInvoicesTable,
} from '../migrations/create-invoices-table.js';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import { listOwnInvoices } from './list-own-invoices.js';

let database: Knex;

beforeEach(async () => {
	database = knex({
		client: 'sqlite3',
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
		pool: { min: 1, max: 1 },
	});

	await database.schema.createTable('directus_collections', (table) => {
		table.string('collection');
		table.string('icon');
		table.boolean('hidden');
		table.integer('sort');
		table.string('group');
	});

	await createSubscriptionTables.config.up(database);
	await addCheckoutColumns.config.up(database);
	await createInvoicesTable.config.up(database);

	await database('subscription_plans').insert({
		code: 'pro',
		name: 'Pro',
		policy: 'policy-1',
		amount: 25,
		currency: 'EUR',
		interval: '{"months":1}',
	});

	await database('subscriptions').insert({
		plan: 1,
		provider: 'stripe',
		status: 'active',
		date_created: '2026-11-01T00:00:00.000Z',
		date_updated: '2026-11-01T00:00:00.000Z',
	});

	await database('subscription_managers')
		.insert({ subscription: 1, user: 'user-payer' });

	await database('subscription_beneficiaries')
		.insert({ subscription: 1, user: 'user-friend' });
});

afterEach(async () => {
	await database.destroy();
});

describe('listOwnInvoices', () => {
	test('lists a manager the invoices, newest first', async () => {
		await database('subscription_invoices').insert([
			{
				subscription: 1,
				provider: 'stripe',
				provider_reference: 'in_1',
				status: 'paid',
				amount: 25,
				currency: 'EUR',
				date_issued: new Date('2026-11-23T10:00:00Z'),
				date_paid: new Date('2026-11-23T10:01:00Z'),
				hosted_url: 'https://invoice.stripe.com/i/in_1',
				pdf_url: 'https://pay.stripe.com/invoice/in_1/pdf',
				date_updated: new Date('2026-11-23T10:02:00Z'),
			},
			{
				subscription: 1,
				provider: 'stripe',
				provider_reference: 'in_2',
				status: 'open',
				amount: 9.9,
				currency: 'EUR',
				date_issued: new Date('2026-12-23T10:00:00Z'),
				date_paid: null,
				hosted_url: null,
				pdf_url: null,
				date_updated: new Date('2026-12-23T10:02:00Z'),
			},
		]);

		expect(await listOwnInvoices(database, 'user-payer', '1')).toEqual([
			{
				id: 2,
				provider_reference: 'in_2',
				status: 'open',
				amount: '9.90',
				currency: 'EUR',
				date_issued: '2026-12-23T10:00:00.000Z',
				date_paid: null,
				hosted_url: null,
				pdf_url: null,
			},
			{
				id: 1,
				provider_reference: 'in_1',
				status: 'paid',
				amount: '25.00',
				currency: 'EUR',
				date_issued: '2026-11-23T10:00:00.000Z',
				date_paid: '2026-11-23T10:01:00.000Z',
				hosted_url: 'https://invoice.stripe.com/i/in_1',
				pdf_url: 'https://pay.stripe.com/invoice/in_1/pdf',
			},
		]);
	});

	test('answers an empty list before the first invoice', async () => {
		expect(await listOwnInvoices(database, 'user-payer', '1')).toEqual([]);
	});

	test.each([
		['a beneficiary', 'user-friend', '1'],
		['a stranger', 'user-stranger', '1'],
		['a missing subscription', 'user-payer', '99'],
		['nobody', null, '1'],
	])('refuses %s with 403', async (_caseName, userId, subscriptionParam) => {
		await expect(listOwnInvoices(database, userId, subscriptionParam))
			.rejects.toThrow(new ForbiddenError());
	});

	test('refuses an id that is no subscription id', async () => {
		await expect(listOwnInvoices(database, 'user-payer', 'mine'))
			.rejects.toThrow(new InvalidPayloadError({
				reason: '"id" must be a subscription id, got "mine"',
			}));
	});
});
