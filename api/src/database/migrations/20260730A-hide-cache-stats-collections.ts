import type { Knex } from 'knex';

// directus_cache_descriptors stays visible — the request dimension (path, method,
// query, sizes per key) is worth browsing. The other three are telemetry noise.
const HIDDEN = [
	'directus_cache_events',
	'directus_cache_anomalies',
	'directus_cache_config_events',
];
const VISIBLE = ['directus_cache_descriptors'];
const ALL = [...HIDDEN, ...VISIBLE];

/**
 * The cache-stats tables are internal: the response-cache pipeline writes them with
 * raw knex (never ItemsService) and reads them via the custom `/utils/cache/*`
 * controllers. Unregistered, they show in Data Model as uncontrolled `directus_`
 * tables. Register them managed instead — the three telemetry tables hidden,
 * `directus_cache_descriptors` visible for inspecting cached-request metadata.
 *
 * They stay inert: raw writes emit no activity/revision, and `accountability: null`
 * means even a manual UI edit wouldn't either.
 *
 * They don't move under the "System Collections" group — that list is fixed in
 * `@directus/system-data`, so `isSystemCollection` treats a `directus_cache_*` name
 * as a regular collection (hidden ones just render greyed).
 */
export async function up(knex: Knex): Promise<void> {
	const rows = ALL.map((collection) => {
		return {
			collection,
			hidden: HIDDEN.includes(collection),
			singleton: false,
			accountability: null,
			note: 'Internal cache statistics — written by the response-cache pipeline.',
		};
	});

	await knex('directus_collections')
		.insert(rows)
		.onConflict('collection')
		.merge(['hidden', 'accountability', 'note']);

	// A stray manual "import" (e.g. anomalies in a dev DB) leaves managed field rows
	// behind; drop them so the columns stay database-only.
	await knex('directus_fields')
		.whereIn('collection', ALL)
		.delete();
}

export async function down(knex: Knex): Promise<void> {
	await knex('directus_collections')
		.whereIn('collection', ALL)
		.delete();
}
