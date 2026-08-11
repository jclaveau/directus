import { useEnv } from '@directus/env';
import type { Knex } from 'knex';
import { getMilliseconds } from '../../utils/get-milliseconds.js';

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
 * `evicted` counts the ENTRIES the operation deleted, excluding each entry's
 * `__expires_at`/`__tags` sidecars, and is NULL for a `namespace` clear — that
 * one has no member list to count, and 0 would read as "took nothing".
 *
 * No surrogate key: a hypertable refuses a unique index that does not include
 * its partitioning column, so an `id` primary key would have to be `(id, time)`
 * to be accepted — a compound key nothing here would ever read by.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable('directus_cache_purges', (table) => {
		table.timestamp('time').notNullable();
		table.string('collection').nullable(); // null on a namespace-wide clear
		// slices | collection | namespace
		table.string('mode', 16).notNullable();
		table.integer('tags').notNullable();
		table.integer('evicted').nullable();
		// Only `time` is indexed: the timeseries filters by it and folds `mode`
		// into a CASE, so an index on a three-value column would be write cost
		// with no reader.
		table.index('time');
	});

	if (knex.client.config.client !== 'pg') {
		return;
	}

	const { rows } = await knex.raw(
		`SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') AS has`,
	);

	if (rows[0].has !== true) {
		return;
	}

	await knex.raw(`SELECT create_hypertable('directus_cache_purges', 'time')`);

	// `mode` is the one low-cardinality column, as `kind` is on the events fact.
	await knex.raw(
		`ALTER TABLE directus_cache_purges SET (
			timescaledb.compress,
			timescaledb.compress_segmentby = 'mode',
			timescaledb.compress_orderby = 'time DESC'
		)`,
	);

	await knex.raw(
		`SELECT add_compression_policy('directus_cache_purges', INTERVAL '2 days')`,
	);

	// Mirrors the app-level reap (CACHE_STATS_RETENTION) so chunk-drop and the
	// cross-dialect sweep agree; a hardcoded window would cap a larger setting.
	const retentionMs = getMilliseconds(
		useEnv()['CACHE_STATS_RETENTION'],
		2_592_000_000,
	);

	await knex.raw(
		`SELECT add_retention_policy('directus_cache_purges', `
		+ `INTERVAL '${retentionMs} milliseconds')`,
	);
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTable('directus_cache_purges');
}
