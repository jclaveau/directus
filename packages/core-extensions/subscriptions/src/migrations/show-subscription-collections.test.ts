import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	showSubscriptionCollections,
} from './show-subscription-collections.js';

let database: Knex;

beforeEach(async () => {
	database = knex({
		client: 'sqlite3',
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
		pool: { min: 1, max: 1 },
	});

	await database.schema.createTable('directus_collections', (table) => {
		table.string('collection');
		table.string('icon');
		table.boolean('hidden');
		table.integer('sort');
		table.string('group');
	});

	await database('directus_collections').insert([
		{
			collection: 'other',
			icon: null,
			hidden: false,
			sort: null,
			group: null,
		},
		{
			collection: 'subscription_sync_queue',
			icon: 'sync_problem',
			hidden: false,
			sort: null,
			group: null,
		},
	]);
});

afterEach(async () => {
	await database.destroy();
});

describe('showSubscriptionCollections', () => {
	test('groups every subscription table under subscriptions', async () => {
		await showSubscriptionCollections.config.up(database);

		expect(await database('directus_collections'))
			.toEqual([
				{
					collection: 'other',
					icon: null,
					hidden: 0,
					sort: null,
					group: null,
				},
				{
					collection: 'subscription_sync_queue',
					icon: 'sync_problem',
					hidden: 0,
					sort: 6,
					group: 'subscriptions',
				},
				{
					collection: 'subscriptions',
					icon: 'card_membership',
					hidden: 0,
					sort: null,
					group: null,
				},
				{
					collection: 'subscribers',
					icon: 'person',
					hidden: 0,
					sort: 1,
					group: 'subscriptions',
				},
				{
					collection: 'subscription_plans',
					icon: 'sell',
					hidden: 0,
					sort: 2,
					group: 'subscriptions',
				},
				{
					collection: 'subscription_events',
					icon: 'history',
					hidden: 1,
					sort: 3,
					group: 'subscriptions',
				},
				{
					collection: 'subscriber_customers',
					icon: 'badge',
					hidden: 1,
					sort: 4,
					group: 'subscriptions',
				},
				{
					collection: 'subscription_plan_references',
					icon: 'link',
					hidden: 1,
					sort: 5,
					group: 'subscriptions',
				},
			]);
	});

	test('leaves the sync queue and other rows as they were', async () => {
		await showSubscriptionCollections.config.up(database);
		await showSubscriptionCollections.config.down(database);

		expect(await database('directus_collections'))
			.toEqual([
				{
					collection: 'other',
					icon: null,
					hidden: 0,
					sort: null,
					group: null,
				},
				{
					collection: 'subscription_sync_queue',
					icon: 'sync_problem',
					hidden: 0,
					sort: null,
					group: null,
				},
			]);
	});
});
