//#region src/database/migrations/20260312A-add-ai-translation-settings.ts
async function up(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.text("ai_translation_default_model").nullable();
		table.json("ai_translation_glossary").nullable();
		table.text("ai_translation_style_guide").nullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.dropColumn("ai_translation_default_model");
		table.dropColumn("ai_translation_glossary");
		table.dropColumn("ai_translation_style_guide");
	});
}

//#endregion
export { down, up };