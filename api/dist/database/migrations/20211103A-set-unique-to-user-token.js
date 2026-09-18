//#region src/database/migrations/20211103A-set-unique-to-user-token.ts
async function up(knex) {
	await knex.schema.alterTable("directus_users", (table) => {
		table.unique(["token"]);
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_users", (table) => {
		table.dropUnique(["token"]);
	});
}

//#endregion
export { down, up };