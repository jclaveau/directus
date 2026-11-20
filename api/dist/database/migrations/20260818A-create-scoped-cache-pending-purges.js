//#region src/database/migrations/20260818A-create-scoped-cache-pending-purges.ts
/**
* Purges that failed after their mutation committed, kept until they succeed.
*
* A purge is awaited inside the mutation but runs after the transaction, so once
* it throws there is nothing left to roll back: the write is durable and only the
* cache is wrong. Failing the request would be worse than the stale entry it would
* report — the client would retry a mutation that already landed, and a
* non-idempotent create would duplicate a row. So the failure is recorded here and
* the request succeeds.
*
* The record has to live in Postgres rather than beside the rest of the cache
* telemetry: `queueCachePurge` and `reportCacheAnomaly` both write to the Redis
* stream, which is the dependency that just failed.
*
* `scoped_cache_tag` holds the display label (`collection:field=value`), the same
* form `directus_scoped_cache_purge_tags` stores, NOT the Redis key. The key
* carries `CACHE_NAMESPACE`, so a namespace change between the failure and the
* retry would leave a row pointing at a key nothing reads; the label is rebuilt
* into a key at retry time against whatever the namespace is then.
*
* `mode` mirrors `directus_cache_purges.mode` and decides what a row means:
*   - `slices`     one tag, the narrowest retry
*   - `collection` this collection's bare tag plus every slice (SCAN + DEL)
*   - `namespace`  the whole data cache; `collection` and the tag are both null
*
* No unique index, deliberately. Postgres treats NULLs as distinct, so one would
* not constrain the coarse rows anyway, and an upsert would cost a round trip on
* a path that only runs while Redis is already down. Repeated failures for one
* slice therefore insert repeatedly; the drain groups them by target in memory
* (`listPendingScopedCachePurges`) and deletes every row a retry finished, so the
* row count is bounded by the writes that happened during the outage.
*/
async function up(knex) {
	await knex.schema.createTable("directus_scoped_cache_pending_purges", (table) => {
		table.increments("id").primary();
		table.timestamp("failed_at").notNullable();
		table.string("mode", 16).notNullable();
		table.string("collection").nullable();
		table.string("scoped_cache_tag").nullable();
		table.integer("attempts").notNullable().defaultTo(0);
		table.text("last_error").nullable();
	});
}
async function down(knex) {
	await knex.schema.dropTableIfExists("directus_scoped_cache_pending_purges");
}

//#endregion
export { down, up };