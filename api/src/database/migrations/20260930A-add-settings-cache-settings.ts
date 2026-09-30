import type { Knex } from 'knex';

/**
 * `directus_settings.cache_settings` — the fleet-wide layer laid over the
 * `CACHE_*` environment, starting with `enabled`.
 *
 * Nullable, and `null` means the whole layer is unset: every field then comes
 * from the environment chain.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_settings', (table) => {
		table.json('cache_settings').nullable();
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_settings', (table) => {
		table.dropColumn('cache_settings');
	});
}
