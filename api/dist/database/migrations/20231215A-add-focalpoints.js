//#region src/database/migrations/20231215A-add-focalpoints.ts
async function up(knex) {
	await knex.schema.alterTable("directus_files", (table) => {
		table.integer("focal_point_x").nullable();
		table.integer("focal_point_y").nullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_files", (table) => {
		table.dropColumn("focal_point_x");
		table.dropColumn("focal_point_y");
	});
}

//#endregion
export { down, up };