//#region src/database/migrations/20211230A-add-project-descriptor.ts
async function up(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.string("project_descriptor", 100).nullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.dropColumn("project_descriptor");
	});
}

//#endregion
export { down, up };