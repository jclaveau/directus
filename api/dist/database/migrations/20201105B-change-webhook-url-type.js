import { getHelpers } from "../helpers/index.js";

//#region src/database/migrations/20201105B-change-webhook-url-type.ts
async function up(knex) {
	const helper = getHelpers(knex).schema;
	const type = helper.isOneOfClients(["oracle", "cockroachdb"]) ? "text" : "string";
	await helper.changeToType("directus_webhooks", "url", type);
}
async function down(knex) {
	await getHelpers(knex).schema.changeToType("directus_webhooks", "url", "string", {
		nullable: false,
		length: 255
	});
}

//#endregion
export { down, up };