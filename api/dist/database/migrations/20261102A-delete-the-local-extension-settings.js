//#region src/database/migrations/20261102A-delete-the-local-extension-settings.ts
/**
* Extensions load only as package dependencies, so the settings rows of the
* extensions folder describe nothing this build reads.
*/
async function up(knex) {
	await knex("directus_extensions").whereIn("bundle", knex.select("id").from("directus_extensions").where("source", "local")).delete();
	await knex("directus_extensions").where("source", "local").delete();
}
async function down(_knex) {}

//#endregion
export { down, up };