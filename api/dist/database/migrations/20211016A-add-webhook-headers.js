//#region src/database/migrations/20211016A-add-webhook-headers.ts
async function up(knex) {
	await knex.schema.alterTable("directus_webhooks", (table) => {
		table.json("headers");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_webhooks", (table) => {
		table.dropColumn("headers");
	});
}

//#endregion
export { down, up };