//#region src/database/migrations/20211009A-add-auth-data.ts
async function up(knex) {
	await knex.schema.alterTable("directus_users", (table) => {
		table.json("auth_data");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_users", (table) => {
		table.dropColumn("auth_data");
	});
}

//#endregion
export { down, up };