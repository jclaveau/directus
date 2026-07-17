import type { Knex } from 'knex';

/**
 * `directus_cache_descriptors.coarse` — the read cached under a bare collection tag
 * despite the collection having `scoped_cache_fields` (no value slice pinned), so it
 * over-purges. A tuning signal counted per entry on the admin page, not an anomaly.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_cache_descriptors', (table) => {
		table
			.boolean('coarse')
			.notNullable()
			.defaultTo(false);
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_cache_descriptors', (table) => {
		table.dropColumn('coarse');
	});
}
