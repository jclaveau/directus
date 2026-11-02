import { getHelpers } from "../helpers/index.js";

//#region src/database/migrations/20220402A-remove-default-value-panel-icon.ts
async function up(knex) {
	await getHelpers(knex).schema.changeToType("directus_panels", "icon", "string", {
		nullable: true,
		default: null,
		length: 30
	});
}
async function down(knex) {
	await getHelpers(knex).schema.changeToType("directus_panels", "icon", "string", {
		nullable: true,
		default: "insert_chart",
		length: 30
	});
}

//#endregion
export { down, up };