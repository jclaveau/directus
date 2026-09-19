//#region src/database/migrations/20210929A-rename-login-action.ts
async function up(knex) {
	await knex("directus_activity").update({ action: "login" }).where("action", "=", "authenticate");
}
async function down(knex) {
	await knex("directus_activity").update({ action: "authenticate" }).where("action", "=", "login");
}

//#endregion
export { down, up };