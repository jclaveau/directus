import { getHelpers } from "../helpers/index.js";

//#region src/database/migrations/20230401A-update-material-icons.ts
async function up(knex) {
	await getHelpers(knex).schema.changeToType("directus_presets", "icon", "string", {
		nullable: true,
		default: "bookmark",
		length: 30
	});
	await knex("directus_presets").update({ icon: "bookmark_border" }).where("icon", "=", "bookmark_outline");
}
async function down(knex) {
	await getHelpers(knex).schema.changeToType("directus_presets", "icon", "string", {
		nullable: true,
		default: "bookmark_outline",
		length: 30
	});
	await knex("directus_presets").update({ icon: "bookmark_outline" }).where("icon", "=", "bookmark_border");
}

//#endregion
export { down, up };