//#region src/database/migrations/20210422A-remove-files-interface.ts
async function up(knex) {
	await knex("directus_fields").update({ interface: "many-to-many" }).where({ interface: "files" });
}
async function down(_knex) {}

//#endregion
export { down, up };