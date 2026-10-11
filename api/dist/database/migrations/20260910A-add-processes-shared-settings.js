//#region src/database/migrations/20260910A-add-processes-shared-settings.ts
/**
* `directus_settings.autoscale_settings` and `.supervisor_settings` — the two
* fleet-wide layers the processes module lays over `PM2_AUTOSCALE_*`, moved off
* Redis and onto the database that owns them.
*
* Nullable, and `null` means the whole layer is unset: every field then comes
* from the environment chain. Two columns rather than one document because the
* loop reads the first on every tick and the second only while a pool is being
* restarted.
*/
async function up(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.json("autoscale_settings").nullable();
		table.json("supervisor_settings").nullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.dropColumn("autoscale_settings");
		table.dropColumn("supervisor_settings");
	});
}

//#endregion
export { down, up };