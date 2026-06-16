//#region src/database/migrations/20260217A-null-item-versions.ts
async function up(knex) {
	await knex.schema.alterTable("directus_versions", (table) => {
		table.string("item").nullable().alter();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_versions", (table) => {
		table.string("item").notNullable().alter();
	});
}

//#endregion
export { down, up };