//#region src/database/migrations/20260626A-add-scoped-cache-fields.ts
async function up(knex) {
	await knex.schema.alterTable("directus_collections", (table) => {
		table.json("scoped_cache_fields").nullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_collections", (table) => {
		table.dropColumn("scoped_cache_fields");
	});
}

//#endregion
export { down, up };