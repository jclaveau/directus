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
 * `tags` holds the tags the purge actually dropped, comma-joined in the display
 * form `collection[:field=value]` — the same spelling the `X-Scoped-Cache-*`
 * headers use and the `__tags` sidecar stores, so a purge row joins directly
 * against an entry's own tags. That join is the point: "written at T0, a purge
 * covering tag X fired at T1, still present" is what proves a missed
 * invalidation, where the counts alone only say something was purged.
 *
 * It is NULL for `collection` and `namespace`, where the list is derived rather
 * than chosen — every slice the scan happened to find, unbounded — and where
 * `collection` plus `mode` already state the reach exactly.
 *
 * `tag_count` is that reach as a number, for every mode.
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
		// Correlates the tag rows below back to one purge, so an entry covered by
		// two of a purge's tags counts that purge once. Not a key: a hypertable
		// refuses a unique index that leaves out its partitioning column.
		table.string('purge_id', 36).notNullable();
		table.string('mode', 16).notNullable();
		table.integer('tag_count').notNullable();
		table.integer('evicted').nullable();
		// Only `time` is indexed: the timeseries filters by it and folds `mode`
		// into a CASE, so an index on a three-value column would be write cost
		// with no reader.
		table.index('time');
	});

	await createTagIndex(knex);

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

/**
 * The two sides of "was this entry covered by that purge?".
 *
 * `directus_cache_entry_tags` is the dimension half: the tags an entry was
 * filled under, written where `respond.ts` already indexes the key into its tag
 * sets. `directus_cache_purge_tags` is the fact half: the tags each purge
 * dropped. Equi-joining them on `tag` answers, per request, how often the cache
 * threw its entry away — the number that only means something beside its hits.
 *
 * Two tables rather than the comma-joined columns they replace: matching joined
 * text against joined text means LIKE, which cannot index and false-matches on
 * a prefix (`articles` against `articles_archive`).
 */
async function createTagIndex(knex: Knex): Promise<void> {
	await knex.schema.createTable('directus_cache_entry_tags', (table) => {
		table.string('cache_key').notNullable(); // → descriptors.cache_key (no FK)
		table.string('tag').notNullable();
		// The tag's own collection, so a collection-wide purge can be attributed
		// without matching tag strings by prefix. Off the TAG, not the
		// descriptor: one entry can read across collections and carry a tag from
		// each, and the descriptor names only the primary one.
		table.string('collection').notNullable();
		table.index('cache_key');
		table.index('tag');
		table.index('collection');
	});

	await knex.schema.createTable('directus_cache_purge_tags', (table) => {
		table.string('purge_id', 36).notNullable();
		table.timestamp('time').notNullable();
		// Empty on a collection-wide purge: it dropped the bare tag AND every
		// slice, so no single tag names its reach — the collection does.
		table.string('tag').notNullable();
		table.string('collection').notNullable();
		table.index('time');
		table.index('tag');
		table.index('collection');
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTable('directus_cache_purge_tags');
	await knex.schema.dropTable('directus_cache_entry_tags');
	await knex.schema.dropTable('directus_cache_purges');
}
