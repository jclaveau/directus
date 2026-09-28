//#region src/database/migrations/20220429D-drop-non-null-from-sender-of-notifications.ts
async function up(knex) {
	await knex.schema.alterTable("directus_notifications", (table) => {
		table.setNullable("sender");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_notifications", (table) => {
		table.dropNullable("sender");
	});
}

//#endregion
export { down, up };