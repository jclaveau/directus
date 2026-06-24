//#region src/database/migrations/20260128A-add-collaborative-editing.ts
async function up(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.boolean("collaborative_editing_enabled").defaultTo(false).notNullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.dropColumn("collaborative_editing_enabled");
	});
}

//#endregion
export { down, up };