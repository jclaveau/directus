//#region src/database/migrations/20210927B-replace-m2m-interface.ts
async function up(knex) {
	await knex("directus_fields").update({ interface: "files" }).where("interface", "=", "list-m2m").andWhere("special", "=", "files");
}
async function down(knex) {
	await knex("directus_fields").update({ interface: "list-m2m" }).where("interface", "=", "files").andWhere("special", "=", "files");
}

//#endregion
export { down, up };