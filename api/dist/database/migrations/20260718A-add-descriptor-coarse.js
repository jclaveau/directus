//#region src/database/migrations/20260718A-add-descriptor-coarse.ts
/**
* `directus_cache_descriptors.coarse` — the read cached under a bare collection tag
* despite the collection having `scoped_cache_fields` (no value slice pinned), so it
* over-purges. A tuning signal counted per entry on the admin page, not an anomaly.
*/
async function up(knex) {
	await knex.schema.alterTable("directus_cache_descriptors", (table) => {
		table.boolean("coarse").notNullable().defaultTo(false);
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_cache_descriptors", (table) => {
		table.dropColumn("coarse");
	});
}

//#endregion
export { down, up };