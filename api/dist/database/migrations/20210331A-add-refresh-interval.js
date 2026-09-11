//#region src/database/migrations/20210331A-add-refresh-interval.ts
async function up(knex) {
	await knex.schema.alterTable("directus_presets", (table) => {
		table.integer("refresh_interval");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_presets", (table) => {
		table.dropColumn("refresh_interval");
	});
}

//#endregion
export { down, up };