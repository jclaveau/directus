//#region src/database/migrations/20260712A-create-cache-anomalies.ts
/**
* `directus_cache_anomalies` — silent cache decisions the fact/dimension can't show:
* a request not cached (missing scope, oversized value) or a Redis error. One row
* per sampled occurrence (throttled per
* reason+key). Normalised: it references the request's `directus_cache_descriptors`
* row for path/method/query, so the admin cache tree can render an anomaly at the
* same path → method+query node as a cached item. A not-cached request still gets a
* descriptor written at the anomaly site purely so this ref resolves in the tree.
*/
async function up(knex) {
	await knex.schema.createTable("directus_cache_anomalies", (table) => {
		table.increments("id");
		table.timestamp("time").notNullable();
		table.string("cache_key").notNullable();
		table.string("reason", 32).notNullable();
		table.text("detail").nullable();
		table.index("time");
		table.index("reason");
		table.index("cache_key");
	});
}
async function down(knex) {
	await knex.schema.dropTable("directus_cache_anomalies");
}

//#endregion
export { down, up };