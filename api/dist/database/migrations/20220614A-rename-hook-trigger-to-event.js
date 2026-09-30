//#region src/database/migrations/20220614A-rename-hook-trigger-to-event.ts
async function up(knex) {
	await knex("directus_flows").update({ trigger: "event" }).where("trigger", "=", "hook");
}
async function down(knex) {
	await knex("directus_flows").update({ trigger: "hook" }).where("trigger", "=", "event");
}

//#endregion
export { down, up };