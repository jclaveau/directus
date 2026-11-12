import { defineMigration } from '@directus/extensions-sdk/scalabus';
import { MAX_SYNC_ATTEMPTS } from '../queue/sync-queue.js';

const PARKED_SYNCS_BOOKMARK = 'Parked syncs';

/**
 * Lists the syncs stuck at the attempt ceiling in the admin. A bookmark only shows
 * under a collection Directus tracks, hence the `directus_collections` row: a
 * `schema apply` of a snapshot made before this runs drops that table and its
 * pending syncs (blackbox `subscription-schema-apply.feature`), so a snapshot to
 * apply is taken after the bundle is installed.
 */
export const createParkedSyncsPreset = defineMigration(
	'20261107A-create-parked-syncs-preset',
	{
		async up(knex) {
			await knex('directus_collections').insert({
				collection: 'subscription_sync_queue',
				icon: 'sync_problem',
			});

			await knex('directus_presets').insert({
				bookmark: PARKED_SYNCS_BOOKMARK,
				collection: 'subscription_sync_queue',
				layout: 'tabular',
				layout_query: JSON.stringify({
					tabular: {
						fields: [
							'provider',
							'resource_id',
							'attempts',
							'next_attempt_at',
							'last_error',
						],
						sort: ['-next_attempt_at'],
					},
				}),
				filter: JSON.stringify({
					_and: [{ attempts: { _gte: MAX_SYNC_ATTEMPTS } }],
				}),
				icon: 'sync_problem',
			});
		},

		async down(knex) {
			await knex('directus_presets')
				.where('bookmark', PARKED_SYNCS_BOOKMARK)
				.where('collection', 'subscription_sync_queue')
				.delete();

			await knex('directus_collections')
				.where('collection', 'subscription_sync_queue')
				.delete();
		},
	},
);
