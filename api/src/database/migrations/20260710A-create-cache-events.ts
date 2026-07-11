import type { Knex } from 'knex';

/**
 * Cache telemetry, split star-schema style:
 *
 *   - `directus_cache_events` — the lean fact: one row per served hit/miss,
 *     keyed by the opaque cache key, carrying only the tuning numbers
 *     (age-at-hit, gap-since-expiry, effective TTL). High volume → a Timescale
 *     hypertable with compression + 90d retention where the extension exists;
 *     on a plain table the app-level reap (CACHE_STATS_RETENTION) bounds growth.
 *   - `directus_cache_descriptors` — the dimension: one row per cache key with
 *     its request descriptor (method/path/collection/user/query/url/size),
 *     upserted on each fill. Low volume, no retention, so a descriptor survives
 *     any TTL; a scheduled reaper prunes keys that stop appearing.
 *
 * The admin page joins hits (fact, windowed) to the descriptor (dimension). The
 * wide text lives once per key in the dimension, keeping the fact narrow.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable('directus_cache_events', (table) => {
		table.timestamp('time').notNullable();
		table.string('cache_key').notNullable();
		table.integer('kind').notNullable(); // 0 hit, 1 miss
		table.bigInteger('age_ms').nullable(); // hit: age-at-hit
		table.bigInteger('gap_ms').nullable(); // miss: time past expiry (null = cold)
		table.bigInteger('ttl_ms').nullable(); // effective TTL in force
		table.bigInteger('duration_ms').nullable(); // hit: cache-serve latency
		// The listing joins + reap scan by cache_key; the retention reap scans by
		// time. Secondary (non-unique) indexes are safe on a Timescale hypertable.
		table.index('cache_key');
		table.index('time');
	});

	await knex.schema.createTable('directus_cache_descriptors', (table) => {
		table.string('cache_key').primary();
		table.string('method').notNullable();
		table.text('path').notNullable();
		table.string('collection').nullable();
		table.uuid('user_id').nullable(); // m2o → directus_users (metadata relation, no FK)
		table.text('query').nullable();
		table.text('url').nullable();
		table.bigInteger('bytes').nullable();
		table.bigInteger('fill_ms').nullable(); // miss: time to compute the response
		table.timestamp('last_filled').notNullable();
		// No index on `path`: it's TEXT (MySQL can't index it without a prefix
		// length) and the dimension is low-volume — evict-by-path scans it cheaply.
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

	await knex.raw(`SELECT create_hypertable('directus_cache_events', 'time')`);

	// Lean fact: no wide dimension left to segment by, so segment on `kind`
	// (the one low-cardinality column) and order by time for range scans.
	await knex.raw(
		`ALTER TABLE directus_cache_events SET (
			timescaledb.compress,
			timescaledb.compress_segmentby = 'kind',
			timescaledb.compress_orderby = 'time DESC'
		)`,
	);

	await knex.raw(
		`SELECT add_compression_policy('directus_cache_events', INTERVAL '2 days')`,
	);

	await knex.raw(
		`SELECT add_retention_policy('directus_cache_events', INTERVAL '90 days')`,
	);
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTable('directus_cache_events');
	await knex.schema.dropTable('directus_cache_descriptors');
}
