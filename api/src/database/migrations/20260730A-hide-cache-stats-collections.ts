import type { Knex } from 'knex';

const COLLECTIONS = [
	'directus_cache_events',
	'directus_cache_descriptors',
	'directus_cache_anomalies',
	'directus_cache_config_events',
];

/**
 * The cache-stats tables are internal: the response-cache pipeline writes them with
 * raw knex (never ItemsService), and are read through the custom `/utils/cache/*`
 * controllers — never as managed collections. Left unregistered they surface in Data
 * Model as uncontrolled `directus_`-prefixed tables. Register them as hidden
 * collections so they tuck under System Collections instead, consistently on every
 * instance.
 *
 * They stay inert: raw writes emit no activity/revision, and `accountability: null`
 * means even a manual UI edit wouldn't either. No `directus_fields` rows, so the
 * columns stay unmanaged.
 */
export async function up(knex: Knex): Promise<void> {
	const rows = COLLECTIONS.map((collection) => {
		return {
			collection,
			hidden: true,
			singleton: false,
			accountability: null,
			note: 'Internal cache statistics — written by the response-cache pipeline.',
		};
	});

	await knex('directus_collections')
		.insert(rows)
		.onConflict('collection')
		.merge(['hidden', 'accountability', 'note']);

	// A stray manual "import" of one of these (e.g. directus_cache_anomalies in a dev
	// DB) leaves managed field rows behind; drop them so all four stay column-less.
	await knex('directus_fields')
		.whereIn('collection', COLLECTIONS)
		.delete();
}

export async function down(knex: Knex): Promise<void> {
	await knex('directus_collections')
		.whereIn('collection', COLLECTIONS)
		.delete();
}
