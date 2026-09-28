//#region src/database/migrations/20210304A-remove-locked-fields.ts
async function up(knex) {
	await knex.schema.alterTable("directus_fields", (table) => {
		table.dropColumn("locked");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_fields", (table) => {
		table.boolean("locked").defaultTo(false).notNullable();
	});
}

//#endregion
export { down, up };