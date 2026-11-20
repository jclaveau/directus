import { getMilliseconds } from "../../utils/get-milliseconds.js";
import { useEnv } from "@directus/env";

//#region src/database/migrations/20260815A-bound-cache-events-growth.ts
/**
* The extension being installed does not make the fact table a hypertable: it
* stayed plain wherever timescaledb arrived after 20260710A ran, and the calls
* below throw there rather than answering no.
*/
async function isCacheEventsHypertable(knex) {
	if (knex.client.config.client !== "pg") return false;
	const { rows: extension } = await knex.raw("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') AS has");
	if (extension[0].has !== true) return false;
	const { rows } = await knex.raw("SELECT EXISTS(SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'directus_cache_events') AS has");
	return rows[0].has === true;
}
/**
* Two changes, one goal: make CACHE_STATS_MAX_BYTES a budget the table can
* stay inside instead of one it trips once and never returns from.
*
* - Timescale's default 7-day chunk is the unit compression works in, and
*   compression only lands two days after a chunk closes — so the newest data
*   stays raw for up to nine days. At production volume that raw head alone
*   outgrew the whole budget, which no retention could have prevented. A
*   one-day chunk caps the head at three days.
* - The retention policy is re-derived from CACHE_STATS_RETENTION. 20260710A
*   froze it from that variable as it stood the day it ran, so every later
*   change moved the app-level reap and left Timescale's chunk-drop behind —
*   and the chunk-drop is the half that returns disk.
*/
async function up(knex) {
	if (!await isCacheEventsHypertable(knex)) return;
	await knex.raw(`SELECT set_chunk_time_interval('directus_cache_events', INTERVAL '1 day')`);
	const retentionMs = getMilliseconds(useEnv()["CACHE_STATS_RETENTION"], 2592e6);
	await knex.raw(`SELECT remove_retention_policy('directus_cache_events', if_exists => true)`);
	await knex.raw(`SELECT add_retention_policy('directus_cache_events', INTERVAL '${retentionMs} milliseconds')`);
}
/**
* The interval only. The policy replaced above held an older snapshot of
* CACHE_STATS_RETENTION and nothing records which one, so restoring it would
* mean inventing a window rather than returning to the previous one.
*/
async function down(knex) {
	if (!await isCacheEventsHypertable(knex)) return;
	await knex.raw(`SELECT set_chunk_time_interval('directus_cache_events', INTERVAL '7 days')`);
}

//#endregion
export { down, up };