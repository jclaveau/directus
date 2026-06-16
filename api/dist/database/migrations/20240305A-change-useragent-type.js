import { getHelpers } from "../helpers/index.js";

//#region src/database/migrations/20240305A-change-useragent-type.ts
async function up(knex) {
	const helper = getHelpers(knex).schema;
	await Promise.all([helper.changeToType("directus_activity", "user_agent", "text"), helper.changeToType("directus_sessions", "user_agent", "text")]);
}
async function down(knex) {
	const helper = getHelpers(knex).schema;
	const opts = {
		nullable: false,
		length: 255
	};
	await Promise.all([helper.changeToType("directus_activity", "user_agent", "string", opts), helper.changeToType("directus_sessions", "user_agent", "string", opts)]);
}

//#endregion
export { down, up };