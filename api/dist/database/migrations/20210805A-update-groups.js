import { parseJSON } from "@directus/utils";

//#region src/database/migrations/20210805A-update-groups.ts
async function up(knex) {
	const groups = await knex.select("*").from("directus_fields").where({ interface: "group-standard" });
	const raw = [];
	const detail = [];
	for (const group of groups) if ((typeof group.options === "string" ? parseJSON(group.options) : group.options || {}).showHeader === true) detail.push(group);
	else raw.push(group);
	for (const field of raw) await knex("directus_fields").update({ interface: "group-raw" }).where({ id: field.id });
	for (const field of detail) await knex("directus_fields").update({ interface: "group-detail" }).where({ id: field.id });
}
async function down(knex) {
	await knex("directus_fields").update({ interface: "group-standard" }).where({ interface: "group-detail" }).orWhere({ interface: "group-raw" });
}

//#endregion
export { down, up };