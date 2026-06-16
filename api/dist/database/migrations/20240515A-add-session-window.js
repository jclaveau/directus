//#region src/database/migrations/20240515A-add-session-window.ts
async function up(knex) {
	await knex.schema.alterTable("directus_sessions", (table) => {
		table.string("next_token", 64).nullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_sessions", (table) => {
		table.dropColumn("next_token");
	});
}

//#endregion
export { down, up };