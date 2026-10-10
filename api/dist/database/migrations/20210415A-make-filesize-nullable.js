import { getHelpers } from "../helpers/index.js";

//#region src/database/migrations/20210415A-make-filesize-nullable.ts
async function up(knex) {
	await getHelpers(knex).schema.changeToType("directus_files", "filesize", "integer", {
		nullable: true,
		default: null
	});
}
async function down(knex) {
	await getHelpers(knex).schema.changeToType("directus_files", "filesize", "integer", {
		nullable: false,
		default: 0
	});
}

//#endregion
export { down, up };