import type { Knex } from 'knex';

/**
 * Adds `prefix` to `directus_cache_anomalies` — the request's first path segment,
 * captured at report time — so the cache page's prefix filter narrows the anomaly
 * series alongside hits/misses (they're plotted together). Nullable so pre-existing
 * rows stay valid; no index, matching the events table's lean-fact stance.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_cache_anomalies', (table) => {
		table.string('prefix', 64).nullable();
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_cache_anomalies', (table) => {
		table.dropColumn('prefix');
	});
}
