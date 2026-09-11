//#region src/database/migrations/20210608A-add-deep-clone-config.ts
async function up(knex) {
	await knex.schema.alterTable("directus_collections", (table) => {
		table.json("item_duplication_fields").nullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_collections", (table) => {
		table.dropColumn("item_duplication_fields");
	});
}

//#endregion
export { down, up };