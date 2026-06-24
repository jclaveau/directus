//#region src/database/migrations/20251103A-add-ai-settings.ts
async function up(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.text("ai_openai_api_key");
		table.text("ai_anthropic_api_key");
		table.text("ai_system_prompt");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.dropColumn("ai_openai_api_key");
		table.dropColumn("ai_anthropic_api_key");
		table.dropColumn("ai_system_prompt");
	});
}

//#endregion
export { down, up };