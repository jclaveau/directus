import type { Knex } from 'knex';

/**
 * `directus_cache_purges` — one row per purge *operation*, not per evicted key.
 * A full flush and a TTL edit already leave a `directus_cache_config_events`
 * marker, but the scoped purges this fork exists for left no trace at all: an
 * entry that vanished was indistinguishable from one that was never written.
 *
 * `mode` is the outcome `purgeScopedCache` already returns:
 *   - `slices`     — the resolved value slices a mutation touched
 *   - `collection` — the coarse fallback, taken when scope values are
 *                    unresolvable: the bare tag plus every slice of the
 *                    collection. The expensive one, and the reason this table
 *                    separates it out rather than counting purges as one number.
 *   - `namespace`  — non-scoped mode, where a mutation clears the whole cache.
 *
 * `evicted` counts the entries the operation actually deleted, which the purge
 * already knows: it reads the tag sets' members before deleting them.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable('directus_cache_purges', (table) => {
		table.increments('id');
		table.timestamp('time').notNullable();
		table.string('collection').nullable(); // null on a namespace-wide flush
		// slices | collection | namespace
		table.string('mode', 16).notNullable();

		table.integer('tags')
			.notNullable()
			.defaultTo(0);

		table.integer('evicted')
			.notNullable()
			.defaultTo(0);

		table.index('time');
		table.index('mode');
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTable('directus_cache_purges');
}
