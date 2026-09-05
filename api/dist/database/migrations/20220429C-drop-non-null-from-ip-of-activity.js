//#region src/database/migrations/20220429C-drop-non-null-from-ip-of-activity.ts
async function up(knex) {
	await knex.schema.alterTable("directus_activity", (table) => {
		table.setNullable("ip");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_activity", (table) => {
		table.dropNullable("ip");
	});
}

//#endregion
export { down, up };