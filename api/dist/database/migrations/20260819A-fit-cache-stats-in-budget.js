import { getMilliseconds } from "../../utils/get-milliseconds.js";
import { useEnv } from "@directus/env";

//#region src/database/migrations/20260819A-fit-cache-stats-in-budget.ts
/**
* Both fact tables, because the byte budget only ever watched one of them:
* the autokill measures `directus_cache_events` alone, so `directus_cache_purges`
* grew on Timescale's 7-day default with nothing reading its size.
*/
const cacheStatsHypertables = ["directus_cache_events", "directus_cache_purges"];
/**
* The extension being installed does not make a fact table a hypertable: it
* stayed plain wherever timescaledb arrived after the table was created, and
* the calls below throw there rather than answering no.
*/
async function isCacheStatsHypertable(knex, table) {
	if (knex.client.config.client !== "pg") return false;
	const { rows: extension } = await knex.raw("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') AS has");
	if (extension[0].has !== true) return false;
	const { rows } = await knex.raw(`SELECT EXISTS(SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = '${table}') AS has`);
	return rows[0].has === true;
}
/**
* 20260815A capped the raw head at three days and the table still tripped its
* budget. Measured on production the day it did: 131 bytes a row raw, 5.9x
* compression, and 1.08M rows a day — so three raw days is 424 MB of a 512 MB
* budget, before a single compressed byte. The head, not the tail, was the
* whole overrun.
*
* A chunk cannot be compressed while `now()` is inside its range, so the raw
* head can never fall below the open chunk — one day, 141 MB. Everything above
* that is the two policy values this migration moves:
*
* - `compress_after` 2 days → 2 hours. The threshold counts from a chunk's
*   CLOSE, not from each row, so on one-day chunks two days of it kept two
*   whole closed chunks raw for nothing. Two hours rather than one keeps the
*   window clear of CACHE_STATS_GAP_LOOKBACK, whose late arrivals would
*   otherwise land in a chunk that just compressed and force it to recompress.
* - `schedule_interval` 12 hours → 1 hour. The job only woke twice a day, which
*   rounded any threshold up to half a day and made the one above moot.
*
* Together they take the raw head to the open chunk alone, which is what makes
* a 14-day window fit: 153 MB raw plus 310 MB compressed against 512 MB.
*
* Retention is re-derived here for the same reason 20260815A had to re-derive
* it — the policy holds whatever CACHE_STATS_RETENTION said the day the last
* migration ran, so the variable moves the app-level reap and leaves the
* chunk-drop behind. The reap is a row DELETE and returns no disk; the
* chunk-drop is the half that does.
*/
async function up(knex) {
	const retentionMs = getMilliseconds(useEnv()["CACHE_STATS_RETENTION"], 2592e6);
	for (const table of cacheStatsHypertables) {
		if (!await isCacheStatsHypertable(knex, table)) continue;
		await knex.raw(`SELECT set_chunk_time_interval('${table}', INTERVAL '1 day')`);
		await knex.raw(`SELECT remove_retention_policy('${table}', if_exists => true)`);
		await knex.raw(`SELECT add_retention_policy('${table}', INTERVAL '${retentionMs} milliseconds')`);
		await knex.raw(`SELECT remove_compression_policy('${table}', if_exists => true)`);
		await knex.raw(`SELECT add_compression_policy('${table}', compress_after => INTERVAL '2 hours', schedule_interval => INTERVAL '1 hour')`);
	}
}
/**
* The compression pair and the purge chunks only.
*
* `directus_cache_events` was already on one-day chunks before this ran, so
* restoring seven days there would undo 20260815A rather than this migration.
* And the retention policy replaced above held an older snapshot of
* CACHE_STATS_RETENTION that nothing records, so returning it would mean
* inventing a window rather than restoring one.
*/
async function down(knex) {
	for (const table of cacheStatsHypertables) {
		if (!await isCacheStatsHypertable(knex, table)) continue;
		if (table === "directus_cache_purges") await knex.raw(`SELECT set_chunk_time_interval('${table}', INTERVAL '7 days')`);
		await knex.raw(`SELECT remove_compression_policy('${table}', if_exists => true)`);
		await knex.raw(`SELECT add_compression_policy('${table}', INTERVAL '2 days')`);
	}
}

//#endregion
export { down, up };