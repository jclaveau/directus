//#region src/database/migrations/20261105A-add-access-managed-by.ts
/**
* The extension granting an access row, as its package name: only that
* extension changes the row.
*/
async function up(knex) {
	await knex.schema.alterTable("directus_access", (table) => {
		table.string("managed_by", 255);
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_access", (table) => {
		table.dropColumn("managed_by");
	});
}

//#endregion
export { down, up };