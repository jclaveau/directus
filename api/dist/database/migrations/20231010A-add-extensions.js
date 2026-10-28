//#region src/database/migrations/20231010A-add-extensions.ts
async function up(knex) {
	await knex.schema.createTable("directus_extensions", (table) => {
		table.string("name").primary().notNullable();
		table.boolean("enabled").defaultTo(true).notNullable();
	});
}
async function down(knex) {
	await knex.schema.dropTable("directus_extensions");
}

//#endregion
export { down, up };