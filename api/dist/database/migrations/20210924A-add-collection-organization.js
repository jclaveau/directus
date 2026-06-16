import { getHelpers } from "../helpers/index.js";

//#region src/database/migrations/20210924A-add-collection-organization.ts
async function up(knex) {
	const helpers = getHelpers(knex);
	await knex.schema.alterTable("directus_collections", (table) => {
		table.integer("sort");
		table.string("group", helpers.schema.getTableNameMaxLength()).references("collection").inTable("directus_collections");
		table.string("collapse").defaultTo("open").notNullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_collections", (table) => {
		table.dropColumn("sort");
		table.dropColumn("group");
		table.dropColumn("collapse");
	});
}

//#endregion
export { down, up };