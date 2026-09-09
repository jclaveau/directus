//#region src/database/migrations/20210811A-add-geometry-config.ts
async function up(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.json("basemaps");
		table.string("mapbox_key");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.dropColumn("basemaps");
		table.dropColumn("mapbox_key");
	});
}

//#endregion
export { down, up };