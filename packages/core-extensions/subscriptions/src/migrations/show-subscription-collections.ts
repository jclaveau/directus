import { defineMigration } from '@directus/extensions-sdk/scalabus';

const PARENT_COLLECTION = 'subscriptions';

const CHILD_COLLECTIONS = [
	{ collection: 'subscribers', icon: 'person', hidden: false },
	{ collection: 'subscription_plans', icon: 'sell', hidden: false },
	{ collection: 'subscription_events', icon: 'history', hidden: true },
	{ collection: 'subscriber_customers', icon: 'badge', hidden: true },
	{ collection: 'subscription_plan_references', icon: 'link', hidden: true },
];

const QUEUE_COLLECTION = 'subscription_sync_queue';

/**
 * Shows the bundle's tables in the admin, under `subscriptions`. A
 * `directus_collections` row makes a table part of `GET /schema/snapshot`, so a
 * `schema apply` of a snapshot made before this runs drops these tables too, not
 * only the sync queue (see create-parked-syncs-preset.ts, core guard #728).
 */
export const showSubscriptionCollections = defineMigration(
	'20261113A-show-subscription-collections',
	{
		async up(knex) {
			await knex('directus_collections').insert({
				collection: PARENT_COLLECTION,
				icon: 'card_membership',
				hidden: false,
				sort: null,
				group: null,
			});

			await knex('directus_collections').insert(
				CHILD_COLLECTIONS.map((childCollection, childIndex) => {
					return {
						...childCollection,
						sort: childIndex + 1,
						group: PARENT_COLLECTION,
					};
				}),
			);

			await knex('directus_collections')
				.where('collection', QUEUE_COLLECTION)
				.update({
					group: PARENT_COLLECTION,
					sort: CHILD_COLLECTIONS.length + 1,
				});
		},

		async down(knex) {
			await knex('directus_collections')
				.where('collection', QUEUE_COLLECTION)
				.update({ group: null, sort: null });

			await knex('directus_collections')
				.whereIn('collection', [
					PARENT_COLLECTION,
					...CHILD_COLLECTIONS.map(({ collection }) => collection),
				])
				.delete();
		},
	},
);
