import type { Knex } from 'knex';

/**
 * `directus_cache_anomalies` — silent cache decisions the fact/dimension can't show:
 * a request not cached (scoped orphan, oversized value), a coarse purge-scope
 * fallback, or a Redis error. One row per sampled occurrence (throttled per
 * reason+key). Normalised: it references the request's `directus_cache_descriptors`
 * row for path/method/query, so the admin cache tree can render an anomaly at the
 * same path → method+query node as a cached item. A not-cached request still gets a
 * descriptor written at the anomaly site purely so this ref resolves in the tree.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable('directus_cache_anomalies', (table) => {
		table.increments('id');
		table.timestamp('time').notNullable();
		table.string('cache_key').notNullable(); // → descriptors.cache_key (no FK)
		// scoped_orphan | value_too_large | redis_error | coarse_scope
		table.string('reason', 32).notNullable();
		table.text('detail').nullable();
		table.index('time');
		table.index('reason');
		table.index('cache_key');
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTable('directus_cache_anomalies');
}
