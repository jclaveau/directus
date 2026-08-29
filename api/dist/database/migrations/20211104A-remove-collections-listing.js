//#region src/database/migrations/20211104A-remove-collections-listing.ts
async function up(knex) {
	await knex.schema.alterTable("directus_roles", (table) => {
		table.dropColumn("collection_list");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_roles", (table) => {
		table.json("collection_list");
	});
}

//#endregion
export { down, up };