import { getHelpers } from "../helpers/index.js";

//#region src/database/migrations/20210312A-webhooks-collections-text.ts
async function up(knex) {
	const helper = getHelpers(knex).schema;
	const type = helper.isOneOfClients(["oracle", "cockroachdb"]) ? "text" : "string";
	await helper.changeToType("directus_webhooks", "collections", type);
}
async function down(knex) {
	await getHelpers(knex).schema.changeToType("directus_webhooks", "collections", "string", {
		nullable: false,
		length: 255
	});
}

//#endregion
export { down, up };