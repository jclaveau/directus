//#region src/database/migrations/20261001A-list-the-pending-purge-fingerprints.ts
const TABLE = "directus_scoped_cache_pending_purges";
/**
* Hold a failed purge's fingerprints in one row, as a json list.
*
* One row per fingerprint made a write touching thousands of keys an insert of
* thousands of rows, six bind parameters each: past 65535 parameters Postgres
* refuses the statement, and the purge it stood for was never retried.
*
* The rows already recorded are dropped rather than folded: the cache they point
* at is flushed before this ships, so nothing is left for them to retry.
*/
async function up(knex) {
	if (!await knex.schema.hasTable(TABLE)) return;
	await knex(TABLE).delete();
	await knex.schema.alterTable(TABLE, (table) => {
		table.dropColumn("scoped_cache_fingerprint");
		table.json("scoped_cache_fingerprints").nullable();
	});
}
async function down(knex) {
	if (!await knex.schema.hasTable(TABLE)) return;
	await knex(TABLE).delete();
	await knex.schema.alterTable(TABLE, (table) => {
		table.dropColumn("scoped_cache_fingerprints");
		table.text("scoped_cache_fingerprint").nullable();
	});
}

//#endregion
export { down, up };