//#region src/database/migrations/20220802A-add-custom-aspect-ratios.ts
async function up(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.json("custom_aspect_ratios");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.dropColumn("custom_aspect_ratios");
	});
}

//#endregion
export { down, up };