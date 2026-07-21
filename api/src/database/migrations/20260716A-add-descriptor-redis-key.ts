import type { Knex } from 'knex';

/**
 * The stats identity is now a fixed-length hash (getCacheKey().hash), so
 * `directus_cache_descriptors.cache_key` holds that hash. Store the actual (possibly
 * long, readable) Redis key alongside it, for the admin page's inspect + eviction —
 * a readable key can no longer overflow the identity column.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_cache_descriptors', (table) => {
		table
			.text('redis_key')
			.notNullable()
			.defaultTo('');
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_cache_descriptors', (table) => {
		table.dropColumn('redis_key');
	});
}
