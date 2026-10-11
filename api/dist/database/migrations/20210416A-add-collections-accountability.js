//#region src/database/migrations/20210416A-add-collections-accountability.ts
async function up(knex) {
	await knex.schema.alterTable("directus_collections", (table) => {
		table.string("accountability").defaultTo("all");
	});
	await knex("directus_collections").update({ accountability: "all" });
}
async function down(knex) {
	await knex.schema.alterTable("directus_collections", (table) => {
		table.dropColumn("accountability");
	});
}

//#endregion
export { down, up };