import { defineMigration } from '@directus/extensions-sdk/scalabus';

export const addCheckoutColumns = defineMigration(
	'20261121A-add-checkout-columns',
	{
		async up(knex) {
			await knex.schema.alterTable('subscriptions', (table) => {
				// The user who checked out: deleting them keeps what they paid.
				table.uuid('payer')
					.nullable()
					.references('id')
					.inTable('directus_users')
					.onDelete('SET NULL');

				// Null when sold at the plan's own `amount`.
				table.decimal('custom_amount', 10, 2)
					.nullable()
					.comment('VAT included, at least the plan\'s amount');

				// Null until a sync compares the provider's billing with the sale.
				table.boolean('billing_mismatch')
					.nullable();

				table.index(['payer']);
			});
		},

		async down(knex) {
			await knex.schema.alterTable('subscriptions', (table) => {
				table.dropIndex(['payer']);
				table.dropForeign(['payer']);
				table.dropColumn('payer');
				table.dropColumn('custom_amount');
				table.dropColumn('billing_mismatch');
			});
		},
	},
);
