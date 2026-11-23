import knex from 'knex';
import { describe, expect, test } from 'vitest';
import { createInvoicesTable } from './create-invoices-table.js';

describe('createInvoicesTable', () => {
	test('creates the invoices table under subscriptions, then drops it', async () => {
		const database = knex({
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

		expect(Object.keys(await database('subscription_invoices').columnInfo()))
			.toEqual([
				'id',
				'subscription',
				'provider',
				'provider_reference',
				'status',
				'amount',
				'currency',
				'date_issued',
				'date_paid',
				'hosted_url',
				'pdf_url',
				'date_updated',
			]);

		expect(await database('directus_collections').select()).toEqual([
			{
				collection: 'subscription_invoices',
				icon: 'receipt_long',
				hidden: 0,
				sort: 6,
				group: 'subscriptions',
			},
		]);

		await createInvoicesTable.config.down(database);

		expect(await database.schema.hasTable('subscription_invoices'))
			.toBe(false);

		expect(await database('directus_collections').select()).toEqual([]);

		await database.destroy();
	});
});
