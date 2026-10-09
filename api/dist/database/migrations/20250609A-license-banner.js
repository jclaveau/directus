import { useEnv } from "@directus/env";
import { toBoolean } from "@directus/utils";

//#region src/database/migrations/20250609A-license-banner.ts
async function up(knex) {
	const acceptedTerms = toBoolean(useEnv()["ACCEPT_TERMS"]);
	await knex.schema.alterTable("directus_settings", (table) => {
		table.boolean("accepted_terms").defaultTo(acceptedTerms);
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.dropColumn("accepted_terms");
	});
}

//#endregion
export { down, up };