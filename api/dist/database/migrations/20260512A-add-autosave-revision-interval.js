//#region src/database/migrations/20260512A-add-autosave-revision-interval.ts
async function up(knex) {
	await knex.schema.alterTable("directus_collections", (table) => {
		table.float("autosave_revision_interval").nullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_collections", (table) => {
		table.dropColumn("autosave_revision_interval");
	});
}

//#endregion
export { down, up };