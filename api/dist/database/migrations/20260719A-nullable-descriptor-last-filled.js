//#region src/database/migrations/20260719A-nullable-descriptor-last-filled.ts
/**
* Make `last_filled` nullable. An anomaly locator (a descriptor written only so the
* anomaly resolves to a tree node) was never filled, so it stores NULL instead of a
* fabricated fill time — which keeps Age/Expires honest and marks it out of the
* entries listing (`WHERE last_filled IS NOT NULL`), no separate flag needed.
*/
async function up(knex) {
	await knex.schema.alterTable("directus_cache_descriptors", (table) => {
		table.timestamp("last_filled").nullable().alter();
	});
}
async function down(knex) {
	await knex("directus_cache_descriptors").whereNull("last_filled").delete();
	await knex.schema.alterTable("directus_cache_descriptors", (table) => {
		table.timestamp("last_filled").notNullable().alter();
	});
}

//#endregion
export { down, up };