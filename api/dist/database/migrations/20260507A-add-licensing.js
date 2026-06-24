//#region src/database/migrations/20260507A-add-licensing.ts
async function up(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.string("license_key").nullable().defaultTo(null);
		table.text("license_token").nullable().defaultTo(null);
	});
	await knex.schema.alterTable("directus_collections", (table) => {
		table.string("status").notNullable().defaultTo("active");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.dropColumn("license_key");
		table.dropColumn("license_token");
	});
	await knex.schema.alterTable("directus_collections", (table) => {
		table.dropColumn("status");
	});
}

//#endregion
export { down, up };