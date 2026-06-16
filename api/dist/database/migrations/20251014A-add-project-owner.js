import { getSchema } from "../../utils/get-schema.js";
import { SettingsService } from "../../services/settings.js";
import { useEnv } from "@directus/env";
import { toBoolean } from "@directus/utils";
import { email } from "zod";

//#region src/database/migrations/20251014A-add-project-owner.ts
async function up(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.string("project_owner");
		table.string("project_usage");
		table.string("org_name");
		table.boolean("product_updates");
		table.string("project_status");
		table.dropColumn("accepted_terms");
	});
	const env = useEnv();
	const settingsService = new SettingsService({ schema: await getSchema() });
	if (email().safeParse(env["PROJECT_OWNER"]).success) await settingsService.setOwner({
		project_owner: env["PROJECT_OWNER"],
		org_name: null,
		project_usage: null,
		product_updates: false
	});
}
async function down(knex) {
	const acceptedTerms = toBoolean(useEnv()["ACCEPT_TERMS"]);
	await knex.schema.alterTable("directus_settings", (table) => {
		table.dropColumn("project_owner");
		table.dropColumn("project_usage");
		table.dropColumn("org_name");
		table.dropColumn("product_updates");
		table.dropColumn("project_status");
		table.boolean("accepted_terms").defaultTo(acceptedTerms);
	});
}

//#endregion
export { down, up };