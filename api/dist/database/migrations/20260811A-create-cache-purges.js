import { getMilliseconds } from "../../utils/get-milliseconds.js";
import { useEnv } from "@directus/env";

//#region src/database/migrations/20260811A-create-cache-purges.ts
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
* The tags a purge dropped are deliberately NOT a column here — they are rows in
* `directus_scoped_cache_purge_tags` below, one per tag, in the display form
* `collection[:field=value]` that the `X-Scoped-Cache-*` headers and the `__tags`
* sidecar already use. That join is the point: "written at T0, a purge covering
* tag X fired at T1, still present" is what proves a missed invalidation, where
* a count alone only says something was purged and leaves you guessing what.
*
* `collection` and `namespace` name no tag there: their reach is derived rather
* than chosen — every slice a scan happened to turn up, unbounded — and
* `collection` plus `mode` already state it exactly. A `collection` purge still
* writes one row, with an EMPTY tag, which is what the coarse attribution pass
* joins on; a `namespace` clear writes none.
*
* `scoped_cache_tag_count` is that reach as a number, for every mode.
*
* `evicted` counts the ENTRIES the operation deleted, excluding each entry's
* `__expires_at`/`__tags` sidecars, and is NULL for a `namespace` clear — that
* one has no member list to count, and 0 would read as "took nothing".
*
* No surrogate key: a hypertable refuses a unique index that does not include
* its partitioning column, so an `id` primary key would have to be `(id, time)`
* to be accepted — a compound key nothing here would ever read by.
*/
async function up(knex) {
	await knex.schema.createTable("directus_cache_purges", (table) => {
		table.timestamp("time").notNullable();
		table.string("collection").nullable();
		table.string("purge_id", 36).notNullable();
		table.string("mode", 16).notNullable();
		table.integer("scoped_cache_tag_count").notNullable();
		table.integer("evicted").nullable();
		table.integer("duration_ms").nullable();
		table.index("time");
	});
	await createScopedCacheTagIndex(knex);
	if (knex.client.config.client !== "pg") return;
	const { rows } = await knex.raw(`SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') AS has`);
	if (rows[0].has !== true) return;
	await knex.raw(`SELECT create_hypertable('directus_cache_purges', 'time')`);
	await knex.raw(`ALTER TABLE directus_cache_purges SET (
			timescaledb.compress,
			timescaledb.compress_segmentby = 'mode',
			timescaledb.compress_orderby = 'time DESC'
		)`);
	await knex.raw(`SELECT add_compression_policy('directus_cache_purges', INTERVAL '2 days')`);
	const retentionMs = getMilliseconds(useEnv()["CACHE_STATS_RETENTION"], 2592e6);
	await knex.raw(`SELECT add_retention_policy('directus_cache_purges', INTERVAL '${retentionMs} milliseconds')`);
}
/**
* The two sides of "was this entry covered by that purge?".
*
* `directus_scoped_cache_entry_tags` is the dimension half: the tags an entry was
* filled under, written where `respond.ts` already indexes the key into its tag
* sets. `directus_scoped_cache_purge_tags` is the fact half: the tags each purge
* dropped. Equi-joining them on `scoped_cache_tag` answers, per request, how
* often the cache threw its entry away — the number that only means something
* beside its hits.
*
* Two tables rather than the comma-joined columns they replace: matching joined
* text against joined text means LIKE, which cannot index and false-matches on
* a prefix (`articles` against `articles_archive`).
*/
async function createScopedCacheTagIndex(knex) {
	await knex.schema.createTable("directus_scoped_cache_entry_tags", (table) => {
		table.string("cache_key").notNullable();
		table.string("scoped_cache_tag").notNullable();
		table.string("collection").notNullable();
		table.index("cache_key");
		table.index("scoped_cache_tag");
		table.index("collection");
	});
	await knex.schema.createTable("directus_scoped_cache_purge_tags", (table) => {
		table.string("purge_id", 36).notNullable();
		table.timestamp("time").notNullable();
		table.string("scoped_cache_tag").notNullable();
		table.string("collection").notNullable();
		table.index("time");
		table.index("scoped_cache_tag");
		table.index("collection");
	});
}
async function down(knex) {
	await knex.schema.dropTable("directus_scoped_cache_purge_tags");
	await knex.schema.dropTable("directus_scoped_cache_entry_tags");
	await knex.schema.dropTable("directus_cache_purges");
}

//#endregion
export { down, up };