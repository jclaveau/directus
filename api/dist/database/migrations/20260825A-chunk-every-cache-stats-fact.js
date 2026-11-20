import { getMilliseconds } from "../../utils/get-milliseconds.js";
import { getHelpers } from "../helpers/index.js";
import { useEnv } from "@directus/env";

//#region src/database/migrations/20260825A-chunk-every-cache-stats-fact.ts
/**
* The third one joins the two 20260819A already held: `purge_tags` stayed a
* plain table when `directus_cache_purges` beside it became a hypertable, so
* nothing ever compressed it and its reaper is a row DELETE that returns no
* disk. It is now the largest table in the database, business tables included.
*/
const cacheStatsFacts = [
	"directus_cache_events",
	"directus_cache_purges",
	"directus_scoped_cache_purge_tags"
];
const CHUNK_INTERVAL = "3 hours";
const PURGE_TAGS = "directus_scoped_cache_purge_tags";
/**
* Every fact table chunked, and every chunk an eighth of the day it was.
*
* - The chunk a fact is currently writing cannot be compressed, `now()` being
*   inside its range, so the raw head is whatever a chunk takes before it
*   closes. On the one-day chunks 20260819A left, that head measured 170 MB of
*   events plus 275 MB of purge tags plus 25 MB of purges: 470 MB of a budget
*   that no compression policy can reach.
* - Three hours because the window this is sized for is three days: an interval
*   near a twenty-fourth of the window keeps the head small enough to leave the
*   budget for history, and gives the eviction ring something small to cut. The
*   head is the term that grows with traffic and cannot be compressed away, so
*   it is the one worth shortening before the traffic arrives.
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
async function up(knex) {
	const { schema } = getHelpers(knex);
	if (!await schema.hasTimescale()) return;
	const retentionMs = getMilliseconds(useEnv()["CACHE_STATS_RETENTION"], 2592e6);
	if (!await schema.isHypertable(PURGE_TAGS)) {
		await knex.raw(`SELECT create_hypertable('${PURGE_TAGS}', 'time', chunk_time_interval => INTERVAL '${CHUNK_INTERVAL}', migrate_data => true, if_not_exists => true)`);
		await knex.raw(`ALTER TABLE ${PURGE_TAGS} SET (
				timescaledb.compress,
				timescaledb.compress_segmentby = 'collection',
				timescaledb.compress_orderby = 'scoped_cache_tag, time DESC'
			)`);
	}
	for (const table of cacheStatsFacts) {
		if (!await schema.isHypertable(table)) continue;
		await knex.raw(`SELECT set_chunk_time_interval('${table}', INTERVAL '${CHUNK_INTERVAL}')`);
		await knex.raw(`SELECT remove_retention_policy('${table}', if_exists => true)`);
		await knex.raw(`SELECT add_retention_policy('${table}', INTERVAL '${retentionMs} milliseconds')`);
		await knex.raw(`SELECT remove_compression_policy('${table}', if_exists => true)`);
		await knex.raw(`SELECT add_compression_policy('${table}', compress_after => INTERVAL '2 hours', schedule_interval => INTERVAL '1 hour')`);
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
async function down(knex) {
	const { schema } = getHelpers(knex);
	if (!await schema.hasTimescale()) return;
	for (const table of cacheStatsFacts) {
		if (!await schema.isHypertable(table)) continue;
		await knex.raw(`SELECT set_chunk_time_interval('${table}', INTERVAL '1 day')`);
	}
	if (!await schema.isHypertable(PURGE_TAGS)) return;
	await knex.raw(`SELECT remove_retention_policy('${PURGE_TAGS}', if_exists => true)`);
	await knex.raw(`SELECT remove_compression_policy('${PURGE_TAGS}', if_exists => true)`);
}

//#endregion
export { down, up };