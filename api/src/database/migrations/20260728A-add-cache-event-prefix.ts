import type { Knex } from 'knex';

/**
 * Adds `prefix` to `directus_cache_events` — the request's first path segment
 * (`/items`, `/utils`, …) captured at hit/miss time. A miss never writes a
 * descriptor, so the opaque `cache_key` is otherwise its only handle; the prefix
 * lets the cache page filter the timeseries by endpoint group (and drop the
 * self-polling `/utils` noise). Nullable so pre-existing rows stay valid; no
 * index, matching the table's lean-fact stance (the query is time-sliced first).
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_cache_events', (table) => {
		table.string('prefix', 64).nullable();
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_cache_events', (table) => {
		table.dropColumn('prefix');
	});
}
