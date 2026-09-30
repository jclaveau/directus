import { getHelpers } from "../helpers/index.js";

//#region src/database/migrations/20220303A-remove-default-project-color.ts
async function up(knex) {
	await getHelpers(knex).schema.changeToType("directus_settings", "project_color", "string", {
		nullable: true,
		default: null,
		length: 50
	});
}
async function down(knex) {
	await getHelpers(knex).schema.changeToType("directus_settings", "project_color", "string", {
		nullable: true,
		default: "#00C897",
		length: 10
	});
}

//#endregion
export { down, up };