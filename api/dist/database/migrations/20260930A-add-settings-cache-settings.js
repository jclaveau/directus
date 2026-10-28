//#region src/database/migrations/20260930A-add-settings-cache-settings.ts
/**
* `directus_settings.cache_settings` — the fleet-wide layer laid over the
* `CACHE_*` environment, starting with `response`.
*
* Nullable, and `null` means the whole layer is unset: every field then comes
* from the environment chain.
*/
async function up(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.json("cache_settings").nullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.dropColumn("cache_settings");
	});
}

//#endregion
export { down, up };