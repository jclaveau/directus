//#region src/database/migrations/20251012A-add-field-searchable.ts
async function up(knex) {
	await knex.schema.alterTable("directus_fields", (table) => {
		table.boolean("searchable").defaultTo(true).notNullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_fields", (table) => {
		table.dropColumn("searchable");
	});
}

//#endregion
export { down, up };