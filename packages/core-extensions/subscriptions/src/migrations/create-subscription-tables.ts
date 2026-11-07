import { defineMigration } from '@directus/extensions-sdk/scalabus';

export const createSubscriptionTables = defineMigration(
	'20261105A-create-subscription-tables',
	{
		async up(knex) {
			// TODO(#610): only Postgres wraps this in a transaction; elsewhere a
			// failure past the first table fails every later boot on "already exists".
			await knex.schema.createTable('subscribers', (table) => {
				table.increments('id');

				table.uuid('user')
					.nullable()
					.unique()
					.references('id')
					.inTable('directus_users')
					.onDelete('SET NULL');
			});

			await knex.schema.createTable('subscriber_customers', (table) => {
				table.increments('id');

				table.integer('subscriber')
					.unsigned()
					.notNullable()
					.references('id')
					.inTable('subscribers')
					.onDelete('CASCADE');

				table.string('provider', 32)
					.notNullable();

				table.string('provider_customer_id', 255)
					.notNullable();

				table.unique(['provider', 'provider_customer_id']);
				table.index(['subscriber']);
			});

			await knex.schema.createTable('subscription_plans', (table) => {
				table.increments('id');

				table.string('code', 64)
					.notNullable()
					.unique();

				table.string('name', 255)
					.notNullable();

				table.uuid('policy')
					.notNullable()
					.references('id')
					.inTable('directus_policies');

				table.integer('amount')
					.notNullable()
					.comment('Cents, VAT included');

				table.string('currency', 3)
					.notNullable();

				table.enu('interval', ['month', 'year'])
					.notNullable();

				table.enu('status', ['active', 'subscriptions-locked', 'archived'])
					.notNullable()
					.defaultTo('active');

				table.index(['policy']);
			});

			await knex.schema.createTable(
				'subscription_plan_references',
				(table) => {
					table.increments('id');

					table.integer('plan')
						.unsigned()
						.notNullable()
						.references('id')
						.inTable('subscription_plans')
						.onDelete('CASCADE');

					table.string('provider', 32)
						.notNullable();

					table.string('reference', 255)
						.notNullable();

					table.unique(['provider', 'reference']);
					table.index(['plan']);
				},
			);

			await knex.schema.createTable('subscriptions', (table) => {
				table.increments('id');

				table.integer('subscriber')
					.unsigned()
					.notNullable()
					.references('id')
					.inTable('subscribers')
					.onDelete('RESTRICT');

				table.integer('customer')
					.unsigned()
					.notNullable()
					.references('id')
					.inTable('subscriber_customers')
					.onDelete('RESTRICT');

				table.integer('plan_reference')
					.unsigned()
					.notNullable()
					.references('id')
					.inTable('subscription_plan_references')
					.onDelete('RESTRICT');

				table.string('provider', 32)
					.notNullable();

				table.string('provider_subscription_id', 255)
					.notNullable();

				table.string('status', 32)
					.notNullable();

				table.timestamp('current_period_end', { useTz: true })
					.nullable();

				table.boolean('cancel_at_period_end')
					.notNullable()
					.defaultTo(false);

				table.uuid('access')
					.nullable()
					.references('id')
					.inTable('directus_access')
					.onDelete('SET NULL');

				table.timestamp('date_created', { useTz: true })
					.notNullable();

				table.timestamp('date_updated', { useTz: true })
					.notNullable();

				table.uuid('user_updated')
					.nullable()
					.references('id')
					.inTable('directus_users')
					.onDelete('SET NULL');

				table.unique(['provider', 'provider_subscription_id']);
				table.index(['subscriber']);
				table.index(['customer']);
				table.index(['plan_reference']);
				table.index(['access']);
				table.index(['user_updated']);
			});

			await knex.schema.createTable('subscription_events', (table) => {
				table.increments('id');

				table.integer('subscription')
					.unsigned()
					.notNullable()
					.references('id')
					.inTable('subscriptions')
					.onDelete('RESTRICT');

				table.string('status', 32)
					.notNullable();

				table.timestamp('current_period_end', { useTz: true })
					.nullable();

				table.boolean('cancel_at_period_end')
					.notNullable();

				table.string('source', 32)
					.notNullable();

				// No foreign key: who asked outlives the deletion of their account.
				table.uuid('user')
					.nullable();

				table.timestamp('date_created', { useTz: true })
					.notNullable();

				table.index(['subscription']);
			});

			await knex.schema.createTable('subscription_sync_queue', (table) => {
				table.increments('id');

				table.string('provider', 32)
					.notNullable();

				table.string('resource_id', 255)
					.notNullable();

				table.boolean('pending')
					.notNullable()
					.defaultTo(true);

				table.integer('attempts')
					.notNullable()
					.defaultTo(0);

				table.timestamp('next_attempt_at', { useTz: true })
					.notNullable();

				table.text('last_error')
					.nullable();

				table.unique(['provider', 'resource_id']);
				table.index(['pending', 'next_attempt_at']);
			});
		},

		async down(knex) {
			await knex.schema.dropTable('subscription_sync_queue');
			await knex.schema.dropTable('subscription_events');
			await knex.schema.dropTable('subscriptions');
			await knex.schema.dropTable('subscription_plan_references');
			await knex.schema.dropTable('subscription_plans');
			await knex.schema.dropTable('subscriber_customers');
			await knex.schema.dropTable('subscribers');
		},
	},
);
