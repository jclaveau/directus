import type { Knex } from 'knex';

/**
 * A bundle declaring its entries in code reports its app entries from the
 * browser, so the server keeps their type to list them between reports.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_extensions', (table) => {
		table.string('type').nullable();
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_extensions', (table) => {
		table.dropColumn('type');
	});
}
