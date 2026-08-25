import { useEnv } from '@directus/env';
import type { Knex } from 'knex';
import { getMilliseconds } from '../../utils/get-milliseconds.js';

/**
 * The third one joins the two 20260819A already held: `purge_tags` stayed a
 * plain table when `directus_cache_purges` beside it became a hypertable, so
 * nothing ever compressed it and its reaper is a row DELETE that returns no
 * disk. It is now the largest table in the database, business tables included.
 */
const cacheStatsFacts = [
	'directus_cache_events',
	'directus_cache_purges',
	'directus_scoped_cache_purge_tags',
];

const CHUNK_INTERVAL = '6 hours';

const PURGE_TAGS = 'directus_scoped_cache_purge_tags';

/**
 * Whether the extension is here at all. It being installed does not make a fact
 * table a hypertable — a table created before it arrived stayed plain — so the
 * per-table probe below answers the other half.
 */
async function hasTimescale(knex: Knex): Promise<boolean> {
	if (knex.client.config.client !== 'pg') {
		return false;
	}

	const { rows } = await knex.raw(
		`SELECT EXISTS(SELECT 1 FROM pg_extension `
		+ `WHERE extname = 'timescaledb') AS has`,
	);

	return rows[0].has === true;
}

// Assumes the extension: the catalog view it reads does not exist without it.
async function isHypertable(knex: Knex, table: string): Promise<boolean> {
	const { rows } = await knex.raw(
		`SELECT EXISTS(SELECT 1 FROM timescaledb_information.hypertables `
		+ `WHERE hypertable_name = '${table}') AS has`,
	);

	return rows[0].has === true;
}

/**
 * Every fact table chunked, and every chunk a quarter of the day it was.
 *
 * - The chunk a fact is currently writing cannot be compressed, `now()` being
 *   inside its range, so the raw head is whatever a chunk takes before it
 *   closes. On the one-day chunks 20260819A left, that head measured 170 MB of
 *   events plus 275 MB of purge tags plus 25 MB of purges: 470 MB of a budget
 *   that no compression policy can reach.
 * - Six hours rather than one: the head shrinks with the interval and the chunk
 *   count grows with it, and fourteen days already holds 56 chunks a fact here.
 * - `compress_after` keeps the two hours 20260819A reasoned about. It counts
 *   from a chunk's CLOSE, so it does not shorten with the interval, and it
 *   still clears CACHE_STATS_GAP_LOOKBACK's late arrivals.
 *
 * Retention is re-derived for the reason 20260819A had to re-derive it: the
 * policy holds whatever CACHE_STATS_RETENTION said the day the last migration
 * ran, so the variable moves the app-level reap and leaves the chunk-drop
 * behind. The reap is a row DELETE and returns no disk; the chunk-drop is the
 * half that does.
 */
export async function up(knex: Knex): Promise<void> {
	if (!(await hasTimescale(knex))) {
		return;
	}

	const retentionMs = getMilliseconds(
		useEnv()['CACHE_STATS_RETENTION'],
		2_592_000_000,
	);

	// Convert the purge-tag fact in place. `migrate_data` copies every existing
	// row into its chunk under an exclusive lock and rebuilds the three indexes
	// chunk by chunk, so the deploy running this stalls writes to the table for
	// as long as the copy takes — 14.6M rows over 2883 MB where it was measured.
	// The rows are pure telemetry, their only reader the cache page's
	// purge-coverage join, so truncating the table first turns that cost into a
	// no-op wherever the history is worth less than the deploy window.
	if (!(await isHypertable(knex, PURGE_TAGS))) {
		await knex.raw(
			`SELECT create_hypertable('${PURGE_TAGS}', 'time', `
			+ `chunk_time_interval => INTERVAL '${CHUNK_INTERVAL}', `
			+ `migrate_data => true, if_not_exists => true)`,
		);

		// Segment on `collection`, the one low-cardinality column: a tag has a row
		// per cache key and would compress into batches of nearly one.
		// TODO(reviewer): `scoped_cache_tag` leads the ordering so its per-batch
		// min/max lets listPurgesCoveringEntry() skip on the column it joins by,
		// with time behind it for the retention scans. Worth an EXPLAIN against a
		// compressed chunk before it is settled.
		await knex.raw(
			`ALTER TABLE ${PURGE_TAGS} SET (
				timescaledb.compress,
				timescaledb.compress_segmentby = 'collection',
				timescaledb.compress_orderby = 'scoped_cache_tag, time DESC'
			)`,
		);
	}

	for (const table of cacheStatsFacts) {
		if (!(await isHypertable(knex, table))) {
			continue;
		}

		// Only chunks cut from here carry it: the open one keeps the range it was
		// cut with, so the head shrinks one chunk after this rather than at once.
		await knex.raw(
			`SELECT set_chunk_time_interval('${table}', INTERVAL '${CHUNK_INTERVAL}')`,
		);

		// Timescale refuses a second policy of either kind on one hypertable, so
		// the other order aborts on every already-migrated database.
		await knex.raw(
			`SELECT remove_retention_policy('${table}', if_exists => true)`,
		);

		await knex.raw(
			`SELECT add_retention_policy('${table}', `
			+ `INTERVAL '${retentionMs} milliseconds')`,
		);

		await knex.raw(
			`SELECT remove_compression_policy('${table}', if_exists => true)`,
		);

		await knex.raw(
			`SELECT add_compression_policy('${table}', `
			+ `compress_after => INTERVAL '2 hours', `
			+ `schedule_interval => INTERVAL '1 hour')`,
		);
	}
}

/**
 * The interval and the purge-tag policies, not the conversion.
 *
 * A hypertable cannot be turned back into a plain table without copying every
 * row out of its chunks, which would cost the deploy a second time to undo a
 * shape nothing else reads. Its policies do go, so a re-`up()` adds them back
 * rather than aborting on the duplicate.
 */
export async function down(knex: Knex): Promise<void> {
	if (!(await hasTimescale(knex))) {
		return;
	}

	for (const table of cacheStatsFacts) {
		if (!(await isHypertable(knex, table))) {
			continue;
		}

		await knex.raw(
			`SELECT set_chunk_time_interval('${table}', INTERVAL '1 day')`,
		);
	}

	if (!(await isHypertable(knex, PURGE_TAGS))) {
		return;
	}

	await knex.raw(
		`SELECT remove_retention_policy('${PURGE_TAGS}', if_exists => true)`,
	);

	await knex.raw(
		`SELECT remove_compression_policy('${PURGE_TAGS}', if_exists => true)`,
	);
}
