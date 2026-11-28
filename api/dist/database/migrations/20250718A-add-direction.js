//#region src/database/migrations/20250718A-add-direction.ts
async function up(knex) {
	await knex.schema.alterTable("directus_users", (table) => {
		table.string("text_direction").defaultTo("auto").notNullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_users", (table) => {
		table.dropColumn("text_direction");
	});
}

//#endregion
export { down, up };