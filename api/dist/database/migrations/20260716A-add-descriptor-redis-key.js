//#region src/database/migrations/20260716A-add-descriptor-redis-key.ts
/**
* The stats identity is now a fixed-length hash (getCacheKey().hash), so
* `directus_cache_descriptors.cache_key` holds that hash. Store the actual (possibly
* long, readable) Redis key alongside it, for the admin page's inspect + eviction —
* a readable key can no longer overflow the identity column.
*/
async function up(knex) {
	await knex.schema.alterTable("directus_cache_descriptors", (table) => {
		table.text("redis_key").notNullable().defaultTo("");
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_cache_descriptors", (table) => {
		table.dropColumn("redis_key");
	});
}

//#endregion
export { down, up };