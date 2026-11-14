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

const PLAN_COLLECTION = 'subscription_plans';

const PLAN_FIELDS = [
	{ field: 'id', interface: 'input', readonly: true, hidden: true },
	{
		field: 'policy',
		special: 'm2o',
		interface: 'select-dropdown-m2o',
		options: JSON.stringify({ template: '{{name}}' }),
		display: 'related-values',
		display_options: JSON.stringify({ template: '{{name}}' }),
	},
	{ field: 'amount', interface: 'input', note: 'VAT included' },
	{
		field: 'currency',
		interface: 'select-dropdown',
		options: JSON.stringify({
			choices: ['EUR', 'USD', 'GBP', 'CHF'].map((currencyCode) => {
				return { text: currencyCode, value: currencyCode };
			}),
		}),
	},
	{
		field: 'interval',
		interface: 'select-dropdown',
		options: JSON.stringify({
			choices: [
				{ text: 'Weekly', value: '{"weeks":1}' },
				{ text: 'Monthly', value: '{"months":1}' },
				{ text: 'Quarterly', value: '{"months":3}' },
				{ text: 'Half-yearly', value: '{"months":6}' },
				{ text: 'Yearly', value: '{"years":1}' },
			],
		}),
	},
];

/**
 * Shows the bundle's tables in the admin, under `subscriptions`, and gives the
 * plan form its dropdowns and an auto-generated id. A
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

			await knex('directus_fields').insert(
				PLAN_FIELDS.map((planField) => {
					return {
						collection: PLAN_COLLECTION,
						readonly: false,
						hidden: false,
						...planField,
					};
				}),
			);
		},

		async down(knex) {
			await knex('directus_fields')
				.where('collection', PLAN_COLLECTION)
				.whereIn('field', PLAN_FIELDS.map(({ field }) => field))
				.delete();

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
