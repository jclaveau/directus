//#region src/database/migrations/20260724A-add-settings-cache-ttl.ts
/**
* `directus_settings.cache_ttl` — a persisted, live-overridable global cache TTL
* edited from the cache page, replacing the env-only `CACHE_TTL` for new entries.
* Free string (same `getMilliseconds` grammar as the env var, e.g. `5m`). Nullable:
* `null` inherits env `CACHE_TTL`, `0` never expires.
*/
async function up(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.string("cache_ttl").nullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.dropColumn("cache_ttl");
	});
}

//#endregion
export { down, up };