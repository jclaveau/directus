import { v7 } from "uuid";

//#region src/database/migrations/20250613A-add-project-id.ts
async function up(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.uuid("project_id");
	});
	const existing = await knex("directus_settings").select("id").first();
	const timestamp = await knex("directus_migrations").select("timestamp").first();
	const msecs = timestamp ? new Date(timestamp.timestamp).getTime() : Date.now();
	if (existing) await knex("directus_settings").update({ project_id: v7({ msecs }) });
	else await knex("directus_settings").insert({ project_id: v7() });
}
async function down(knex) {
	await knex.schema.alterTable("directus_settings", (table) => {
		table.dropColumn("project_id");
	});
}

//#endregion
export { down, up };