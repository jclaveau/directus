import { defineMigration } from '@directus/extensions-sdk/scalabus';

export const createInvitesTable = defineMigration(
	'20261122A-create-invites-table',
	{
		async up(knex) {
			// The users a beneficiary email invited, which the sweep deletes once
			// they hold no seat. Deleting the user takes its row along.
			await knex.schema.createTable('subscription_invites', (table) => {
				table.increments('id');

				table.uuid('user')
					.notNullable()
					.unique()
					.references('id')
					.inTable('directus_users')
					.onDelete('CASCADE');

				table.timestamp('date_sent', { useTz: true })
					.notNullable();
			});
		},

		async down(knex) {
			await knex.schema.dropTable('subscription_invites');
		},
	},
);
