import type { Knex } from 'knex';

/**
 * `directus_cache_anomalies` — the third cache-telemetry table, for what the
 * hit/miss fact and the descriptor dimension can't record: a request silently
 * NOT cached (scoped orphan, oversized value), one cached but untrackable (key
 * past the descriptor's 255-char column), a degraded purge scope (coarse
 * fallback), or a Redis read/write error. One row per sampled occurrence — the
 * emitter throttles per reason+path, so this stays low volume.
 *
 * Insert-only fact with a surrogate key: unlike the descriptor it can't be keyed
 * by the cache key (a `key_too_long` anomaly is BORN of a key the 255-char column
 * can't hold), and unlike the events fact it carries the wide request context the
 * admin page groups by. Low volume → a plain table bounded by the daily retention
 * reap, no hypertable.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable('directus_cache_anomalies', (table) => {
		table.increments('id');
		table.timestamp('time').notNullable();
		// key_too_long | scoped_orphan | value_too_large | redis_error | coarse_scope
		table.string('reason', 32).notNullable();
		table.text('path').notNullable();
		table.string('collection').nullable();
		table.string('method', 16).nullable();
		table.integer('key_length').nullable(); // key_too_long: the untrackable key's length
		table.text('detail').nullable(); // key preview / byte size / error message
		// The retention reap scans by time; the listing windows + groups by both.
		table.index('time');
		table.index('reason');
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTable('directus_cache_anomalies');
}
