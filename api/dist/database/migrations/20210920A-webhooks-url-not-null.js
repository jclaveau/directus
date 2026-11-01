import { getHelpers } from "../helpers/index.js";

//#region src/database/migrations/20210920A-webhooks-url-not-null.ts
async function up(knex) {
	const helper = getHelpers(knex).schema;
	if (helper.isOneOfClients(["oracle", "cockroachdb"])) return;
	await helper.changeToType("directus_webhooks", "url", "string", { nullable: false });
}
async function down(knex) {
	const helper = getHelpers(knex).schema;
	if (helper.isOneOfClients(["oracle", "cockroachdb"])) return;
	await helper.changeToType("directus_webhooks", "url", "string");
}

//#endregion
export { down, up };