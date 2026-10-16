//#region src/database/migrations/20220314A-add-translation-strings.ts
async function up(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.json("translation_strings");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.dropColumn("translation_strings");
	});
}

//#endregion
export { down, up };