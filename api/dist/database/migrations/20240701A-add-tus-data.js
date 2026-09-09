//#region src/database/migrations/20240701A-add-tus-data.ts
async function up(knex) {
	await knex.schema.alterTable("directus_files", (table) => {
		table.string("tus_id", 64).nullable();
		table.json("tus_data").nullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_files", (table) => {
		table.dropColumn("tus_id");
		table.dropColumn("tus_data");
	});
}

//#endregion
export { down, up };