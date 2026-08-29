//#region src/database/migrations/20260706A-add-policy-db-connections.ts
async function up(knex) {
	await knex.schema.alterTable("directus_policies", (table) => {
		table.text("db_connections");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_policies", (table) => {
		table.dropColumn("db_connections");
	});
}

//#endregion
export { down, up };