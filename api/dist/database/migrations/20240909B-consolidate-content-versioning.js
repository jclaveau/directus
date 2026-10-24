//#region src/database/migrations/20240909B-consolidate-content-versioning.ts
async function up(knex) {
	await knex.schema.alterTable("directus_versions", (table) => {
		table.json("delta");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_versions", (table) => {
		table.dropColumn("delta");
	});
}

//#endregion
export { down, up };