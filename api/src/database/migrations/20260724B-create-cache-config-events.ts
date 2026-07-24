import type { Knex } from 'knex';

/**
 * `directus_cache_config_events` — a small append-only log of admin cache actions
 * (a TTL change, a flush), so the cache page can plot them as markers over the
 * hits/miss/anomaly timeseries. Recorded unconditionally (not gated on cache-stats)
 * so a change made while stats were off still shows once they come back on.
 *   - `kind` — `ttl_change` | `flush`.
 *   - `detail` — the new TTL value (ttl_change) or the comma-joined targets (flush).
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable('directus_cache_config_events', (table) => {
		table.increments('id');
		table.timestamp('time').notNullable();
		table.string('kind', 16).notNullable();
		table.text('detail').nullable();
		table.index('time');
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTable('directus_cache_config_events');
}
