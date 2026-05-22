//#region src/database/migrations/20210521A-add-collections-icon-color.ts
async function up(knex) {
	await knex.schema.alterTable("directus_collections", (table) => {
		table.string("color").nullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_collections", (table) => {
		table.dropColumn("color");
	});
}

//#endregion
export { down, up };