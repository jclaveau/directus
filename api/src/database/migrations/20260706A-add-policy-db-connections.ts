import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_policies', (table) => {
		// CSV of connection names this policy grants access to (mirrors `ip_access`)
		table.text('db_connections');
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_policies', (table) => {
		table.dropColumn('db_connections');
	});
}
