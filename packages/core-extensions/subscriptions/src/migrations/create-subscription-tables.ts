import { defineMigration } from '@directus/extensions-sdk/scalabus';

export const createSubscriptionTables = defineMigration(
	'20261105A-create-subscription-tables',
	{
		async up(knex) {
			// TODO(#610): only Postgres wraps this in a transaction; elsewhere a
			// failure past the first table fails every later boot on "already exists".
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

				table.decimal('amount', 10, 2)
					.notNullable()
					.comment('VAT included');

				table.string('currency', 3)
					.notNullable();

				table.string('interval', 32)
					.notNullable()
					.comment('date-fns Duration as JSON, e.g. {"months":1}');

				table.integer('beneficiaries_max')
					.notNullable()
					.defaultTo(1);

				table.enu('status', ['active', 'subscriptions-locked', 'archived'])
					.notNullable()
					.defaultTo('active');

				table.index(['policy']);
			});

			await knex.schema.createTable('subscriptions', (table) => {
				table.increments('id');

				table.integer('plan')
					.unsigned()
					.notNullable()
					.references('id')
					.inTable('subscription_plans')
					.onDelete('RESTRICT');

				// The row a resume (or later a plan switch) carries on: Mollie cannot
				// undo a cancel, so a resume is a new subscription.
				table.integer('continues')
					.unsigned()
					.nullable()
					.unique()
					.references('id')
					.inTable('subscriptions')
					.onDelete('RESTRICT');

				table.string('provider', 32)
					.notNullable();

				// Both null while pending: the provider's checkout fills them.
				table.string('provider_customer_id', 255)
					.nullable();

				table.string('provider_subscription_id', 255)
					.nullable();

				table.string('status', 32)
					.notNullable();

				table.timestamp('current_period_end', { useTz: true })
					.nullable();

				table.boolean('cancel_at_period_end')
					.notNullable()
					.defaultTo(false);

				table.uuid('user_updated')
					.nullable()
					.references('id')
					.inTable('directus_users')
					.onDelete('SET NULL');

				table.timestamp('date_created', { useTz: true })
					.notNullable();

				table.timestamp('date_updated', { useTz: true })
					.notNullable();

				table.unique(['provider', 'provider_subscription_id']);
				table.index(['plan']);
				table.index(['user_updated']);
			});

			await knex.schema.createTable('subscription_managers', (table) => {
				table.increments('id');

				table.integer('subscription')
					.unsigned()
					.notNullable()
					.references('id')
					.inTable('subscriptions')
					.onDelete('RESTRICT');

				// A deleted account stops managing; the last one gone cancels.
				table.uuid('user')
					.notNullable()
					.references('id')
					.inTable('directus_users')
					.onDelete('CASCADE');

				table.unique(['subscription', 'user']);
				table.index(['user']);
			});

			await knex.schema.createTable('subscription_beneficiaries', (table) => {
				table.increments('id');

				table.integer('subscription')
					.unsigned()
					.notNullable()
					.references('id')
					.inTable('subscriptions')
					.onDelete('RESTRICT');

				table.uuid('user')
					.nullable()
					.references('id')
					.inTable('directus_users')
					.onDelete('SET NULL');

				table.uuid('access')
					.nullable()
					.references('id')
					.inTable('directus_access')
					.onDelete('SET NULL');

				table.unique(['subscription', 'user']);
				table.index(['user']);
				table.index(['access']);
			});

			await knex.schema.createTable('subscription_events', (table) => {
				table.increments('id');

				// Null on a `webhook_unreadable` row, which names no subscription.
				table.integer('subscription')
					.unsigned()
					.nullable()
					.references('id')
					.inTable('subscriptions')
					.onDelete('RESTRICT');

				table.string('status', 32)
					.nullable();

				table.timestamp('current_period_end', { useTz: true })
					.nullable();

				table.boolean('cancel_at_period_end')
					.nullable();

				table.string('source', 32)
					.notNullable();

				// No foreign key: who asked outlives the deletion of their account.
				table.uuid('user')
					.nullable();

				table.timestamp('date_created', { useTz: true })
					.notNullable();

				// The body of a `webhook_unreadable` row, as the provider sent it.
				table.text('payload')
					.nullable();

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
			await knex.schema.dropTable('subscription_beneficiaries');
			await knex.schema.dropTable('subscription_managers');
			await knex.schema.dropTable('subscriptions');
			await knex.schema.dropTable('subscription_plans');
		},
	},
);
