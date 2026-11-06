import type { Knex } from 'knex';

/**
 * The extension granting an access row, as its package name: only that
 * extension changes the row.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_access', (table) => {
		table.string('managed_by', 255);
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_access', (table) => {
		table.dropColumn('managed_by');
	});
}
