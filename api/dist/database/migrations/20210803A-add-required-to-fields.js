//#region src/database/migrations/20210803A-add-required-to-fields.ts
async function up(knex) {
	await knex.schema.alterTable("directus_fields", (table) => {
		table.boolean("required").defaultTo(false);
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_fields", (table) => {
		table.dropColumn("required");
	});
}

//#endregion
export { down, up };