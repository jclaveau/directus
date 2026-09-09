//#region src/database/migrations/20220429B-add-color-to-insights-icon.ts
async function up(knex) {
	await knex.schema.alterTable("directus_dashboards", (table) => {
		table.string("color").nullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_dashboards", (table) => {
		table.dropColumn("color");
	});
}

//#endregion
export { down, up };