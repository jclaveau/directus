//#region src/database/migrations/20260924A-name-the-pending-purge-fingerprint.ts
const TABLE = "directus_scoped_cache_pending_purges";
/**
* The retry queue aims at a fingerprint, so the column says fingerprint.
*
* `scoped_cache_tag` was accurate while a target was one flat
* `collection:field=value` label. A row now holds a rendered fingerprint — every
* pin of one query case in a single token — and the drain hands it straight back
* to the purge as `scopedCacheFingerprints`.
*
* The two tables the telemetry writes hold one pin per row rather than a
* fingerprint, and take that word in `20260924B`.
*
* Metadata only on every dialect here, and the table holds rows only between a
* failed purge and its retry.
*/
async function renameColumnTo(knex, from, to) {
	if (!await knex.schema.hasTable(TABLE)) return;
	const present = await knex.schema.hasColumn(TABLE, from);
	const taken = await knex.schema.hasColumn(TABLE, to);
	if (!present || taken) return;
	await knex.schema.alterTable(TABLE, (table) => {
		table.renameColumn(from, to);
	});
}
async function up(knex) {
	await renameColumnTo(knex, "scoped_cache_tag", "scoped_cache_fingerprint");
}
async function down(knex) {
	await renameColumnTo(knex, "scoped_cache_fingerprint", "scoped_cache_tag");
}

//#endregion
export { down, up };