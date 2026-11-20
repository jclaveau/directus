//#region src/database/migrations/20210716A-add-conditions-to-fields.ts
async function up(knex) {
	await knex.schema.alterTable("directus_fields", (table) => {
		table.json("conditions");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_fields", (table) => {
		table.dropColumn("conditions");
	});
}

//#endregion
export { down, up };