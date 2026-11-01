//#region src/database/migrations/20260731A-unmanage-cache-stats-collections.ts
const HIDDEN = [
	"directus_cache_events",
	"directus_cache_anomalies",
	"directus_cache_config_events"
];
const VISIBLE = ["directus_cache_descriptors"];
const ALL = [...HIDDEN, ...VISIBLE];
/**
* Supersedes `20260730A`. The four cache-stats tables are now registered in
* `@directus/system-data`, so `isSystemCollection` returns true and they drop out
* of the schema snapshot/apply scope — the proper fix for the reconcile that dropped
* them while their migration rows survived (#323).
*
* The `directus_collections` rows `20260730A` inserted are now both redundant and
* harmful: `CollectionsService.readByQuery` appends the system-data rows without
* deduping by name, so a DB row of the same name yields a SECOND collection entry
* whose `meta.system` is falsy — it slips back past the snapshot's `excludeSystem`
* filter and re-enters the drop scope. Delete them so the system-data registration
* alone governs them (hidden/visible comes from `collections.yaml` now).
*/
async function up(knex) {
	await knex("directus_fields").whereIn("collection", ALL).delete();
	await knex("directus_collections").whereIn("collection", ALL).delete();
}
async function down(knex) {
	const rows = ALL.map((collection) => {
		return {
			collection,
			hidden: HIDDEN.includes(collection),
			singleton: false,
			accountability: null,
			note: "Internal cache statistics — written by the response-cache pipeline."
		};
	});
	await knex("directus_collections").insert(rows).onConflict("collection").merge([
		"hidden",
		"accountability",
		"note"
	]);
}

//#endregion
export { down, up };