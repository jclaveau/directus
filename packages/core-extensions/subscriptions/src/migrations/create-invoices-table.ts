import { defineMigration } from '@directus/extensions-sdk/scalabus';

export const createInvoicesTable = defineMigration(
	'20261123A-create-invoices-table',
	{
		async up(knex) {
			// What the provider billed for a subscription, copied on each sync:
			// Stripe's invoices, Mollie's payments. The provider's row is the truth.
			await knex.schema.createTable('subscription_invoices', (table) => {
				table.increments('id');

				table.integer('subscription')
					.unsigned()
					.notNullable()
					.references('id')
					.inTable('subscriptions')
					.onDelete('RESTRICT');

				table.string('provider', 32)
					.notNullable();

				// `in_…` on Stripe, `tr_…` on Mollie.
				table.string('provider_reference')
					.notNullable();

				// The provider's own word: `paid`, `open`, `failed`…
				table.string('status', 32)
					.notNullable();

				table.decimal('amount', 10, 2)
					.notNullable();

				table.string('currency', 3)
					.notNullable();

				table.timestamp('date_issued', { useTz: true })
					.notNullable();

				table.timestamp('date_paid', { useTz: true })
					.nullable();

				table.text('hosted_url')
					.nullable();

				table.text('pdf_url')
					.nullable();

				table.timestamp('date_updated', { useTz: true })
					.notNullable();

				table.unique(['provider', 'provider_reference']);
				table.index(['subscription']);
			});

			await knex('directus_collections').insert({
				collection: 'subscription_invoices',
				icon: 'receipt_long',
				hidden: false,
				sort: 6,
				group: 'subscriptions',
			});
		},

		async down(knex) {
			await knex('directus_collections')
				.where('collection', 'subscription_invoices')
				.delete();

			await knex.schema.dropTable('subscription_invoices');
		},
	},
);
