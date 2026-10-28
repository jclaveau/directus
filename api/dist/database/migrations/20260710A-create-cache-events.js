import { getMilliseconds } from "../../utils/get-milliseconds.js";
import { useEnv } from "@directus/env";

//#region src/database/migrations/20260710A-create-cache-events.ts
/**
* Cache telemetry, split star-schema style:
*
*   - `directus_cache_events` — the lean fact: one row per served hit/miss,
*     keyed by the opaque cache key, carrying only the tuning numbers
*     (age-at-hit, gap-since-expiry, effective TTL). High volume → a Timescale
*     hypertable with compression + a CACHE_STATS_RETENTION-driven retention
*     policy where the extension exists; on a plain table the same env drives the
*     app-level reap that bounds growth.
*   - `directus_cache_descriptors` — the dimension: one row per cache key with
*     its request descriptor (method/path/collection/user/query/url/size),
*     upserted on each fill. Low volume, no retention, so a descriptor survives
*     any TTL; a scheduled reaper prunes keys that stop appearing.
*
* The admin page joins hits (fact, windowed) to the descriptor (dimension). The
* wide text lives once per key in the dimension, keeping the fact narrow.
*/
async function up(knex) {
	await knex.schema.createTable("directus_cache_events", (table) => {
		table.timestamp("time").notNullable();
		table.string("cache_key").notNullable();
		table.integer("kind").notNullable();
		table.bigInteger("age_ms").nullable();
		table.bigInteger("gap_ms").nullable();
		table.bigInteger("ttl_ms").nullable();
		table.bigInteger("duration_ms").nullable();
		table.index("cache_key");
		table.index("time");
	});
	await knex.schema.createTable("directus_cache_descriptors", (table) => {
		table.string("cache_key").primary();
		table.string("method").notNullable();
		table.text("path").notNullable();
		table.string("collection").nullable();
		table.uuid("user_id").nullable();
		table.text("query").nullable();
		table.text("url").nullable();
		table.bigInteger("bytes").nullable();
		table.bigInteger("fill_ms").nullable();
		table.timestamp("last_filled").notNullable();
	});
	if (knex.client.config.client !== "pg") return;
	const { rows } = await knex.raw(`SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') AS has`);
	if (rows[0].has !== true) return;
	const env = useEnv();
	await knex.raw(`SELECT create_hypertable('directus_cache_events', 'time')`);
	await knex.raw(`ALTER TABLE directus_cache_events SET (
			timescaledb.compress,
			timescaledb.compress_segmentby = 'kind',
			timescaledb.compress_orderby = 'time DESC'
		)`);
	await knex.raw(`SELECT add_compression_policy('directus_cache_events', INTERVAL '2 days')`);
	const retentionMs = getMilliseconds(env["CACHE_STATS_RETENTION"], 2592e6);
	await knex.raw(`SELECT add_retention_policy('directus_cache_events', INTERVAL '${retentionMs} milliseconds')`);
}
async function down(knex) {
	await knex.schema.dropTable("directus_cache_events");
	await knex.schema.dropTable("directus_cache_descriptors");
}

//#endregion
export { down, up };