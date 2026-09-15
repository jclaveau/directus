import { getHelpers } from "../helpers/index.js";

//#region src/database/migrations/20210626A-change-filesize-bigint.ts
async function up(knex) {
	if (getHelpers(knex).schema.isOneOfClients(["oracle", "cockroachdb"])) return;
	await knex.schema.alterTable("directus_files", (table) => {
		table.bigInteger("filesize").nullable().defaultTo(null).alter();
	});
}
async function down(knex) {
	if (getHelpers(knex).schema.isOneOfClients(["oracle", "cockroachdb"])) return;
	await knex.schema.alterTable("directus_files", (table) => {
		table.integer("filesize").nullable().defaultTo(null).alter();
	});
}

//#endregion
export { down, up };