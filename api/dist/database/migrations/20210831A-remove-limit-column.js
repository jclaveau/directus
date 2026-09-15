//#region src/database/migrations/20210831A-remove-limit-column.ts
async function up(knex) {
	await knex.schema.alterTable("directus_permissions", (table) => {
		table.dropColumn("limit");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_permissions", (table) => {
		table.integer("limit").unsigned();
	});
}

//#endregion
export { down, up };