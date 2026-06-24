//#region src/database/migrations/20220308A-add-bookmark-icon-and-color.ts
async function up(knex) {
	await knex.schema.alterTable("directus_presets", (table) => {
		table.string("icon", 30).notNullable().defaultTo("bookmark_outline");
		table.string("color").nullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_presets", (table) => {
		table.dropColumn("icon");
		table.dropColumn("color");
	});
}

//#endregion
export { down, up };