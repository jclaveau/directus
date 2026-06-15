//#region src/database/migrations/20230525A-add-preview-settings.ts
async function up(knex) {
	await knex.schema.alterTable("directus_collections", (table) => {
		table.string("preview_url").nullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_collections", (table) => {
		table.dropColumn("preview_url");
	});
}

//#endregion
export { down, up };