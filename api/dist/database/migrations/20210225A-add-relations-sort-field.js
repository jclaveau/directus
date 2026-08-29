import { getHelpers } from "../helpers/index.js";
import { parseJSON } from "@directus/utils";

//#region src/database/migrations/20210225A-add-relations-sort-field.ts
async function up(knex) {
	const helpers = getHelpers(knex);
	await knex.schema.alterTable("directus_relations", (table) => {
		table.string("sort_field", helpers.schema.getColumnNameMaxLength());
	});
	const fieldsWithSort = await knex.select("collection", "field", "options").from("directus_fields").whereIn("interface", [
		"one-to-many",
		"m2a-builder",
		"many-to-many"
	]);
	for (const field of fieldsWithSort) {
		const options = typeof field.options === "string" ? parseJSON(field.options) : field.options ?? {};
		if ("sortField" in options) await knex("directus_relations").update({ sort_field: options.sortField }).where({
			one_collection: field.collection,
			one_field: field.field
		});
	}
}
async function down(knex) {
	await knex.schema.alterTable("directus_relations", (table) => {
		table.dropColumn("sort_field");
	});
}

//#endregion
export { down, up };