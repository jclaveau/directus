import { getHelpers } from "../helpers/index.js";

//#region src/database/migrations/20210907A-webhooks-collections-not-null.ts
async function up(knex) {
	const helper = getHelpers(knex).schema;
	const type = helper.isOneOfClients(["oracle", "cockroachdb"]) ? "text" : "string";
	await helper.changeToType("directus_webhooks", "collections", type, { nullable: false });
}
async function down(knex) {
	const helper = getHelpers(knex).schema;
	const type = helper.isOneOfClients(["oracle", "cockroachdb"]) ? "text" : "string";
	await helper.changeToType("directus_webhooks", "collections", type);
}

//#endregion
export { down, up };