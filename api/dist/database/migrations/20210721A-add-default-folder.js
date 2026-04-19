import { getDefaultIndexName } from "../../utils/get-default-index-name.js";

//#region src/database/migrations/20210721A-add-default-folder.ts
const indexName = getDefaultIndexName("foreign", "directus_settings", "storage_default_folder");
async function up(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.uuid("storage_default_folder").references("id").inTable("directus_folders").withKeyName(indexName).onDelete("SET NULL");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_files", (table) => {
		table.dropForeign(["storage_default_folder"], indexName);
		table.dropColumn("storage_default_folder");
	});
}

//#endregion
export { down, up };