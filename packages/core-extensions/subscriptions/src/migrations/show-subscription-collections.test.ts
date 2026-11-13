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

	await database.schema.createTable('directus_fields', (table) => {
		table.string('collection');
		table.string('field');
		table.string('special');
		table.string('interface');
		table.json('options');
		table.string('display');
		table.json('display_options');
		table.boolean('readonly').defaultTo(false);
		table.boolean('hidden').defaultTo(false);
		table.text('note');
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

	test('gives the plan form its dropdowns and an auto-generated id', async () => {
		await showSubscriptionCollections.config.up(database);

		expect(await database('directus_fields'))
			.toEqual([
				{
					collection: 'subscription_plans',
					field: 'id',
					special: null,
					interface: 'input',
					options: null,
					display: null,
					display_options: null,
					readonly: 1,
					hidden: 1,
					note: null,
				},
				{
					collection: 'subscription_plans',
					field: 'policy',
					special: 'm2o',
					interface: 'select-dropdown-m2o',
					options: '{"template":"{{name}}"}',
					display: 'related-values',
					display_options: '{"template":"{{name}}"}',
					readonly: 0,
					hidden: 0,
					note: null,
				},
				{
					collection: 'subscription_plans',
					field: 'amount',
					special: null,
					interface: 'input',
					options: null,
					display: null,
					display_options: null,
					readonly: 0,
					hidden: 0,
					note: 'VAT included',
				},
				{
					collection: 'subscription_plans',
					field: 'currency',
					special: null,
					interface: 'select-dropdown',
					options: '{"choices":[{"text":"EUR","value":"EUR"},'
						+ '{"text":"USD","value":"USD"},{"text":"GBP","value":"GBP"},'
						+ '{"text":"CHF","value":"CHF"}]}',
					display: null,
					display_options: null,
					readonly: 0,
					hidden: 0,
					note: null,
				},
				{
					collection: 'subscription_plans',
					field: 'interval',
					special: null,
					interface: 'select-dropdown',
					options: '{"choices":['
						+ '{"text":"Weekly","value":"{\\"weeks\\":1}"},'
						+ '{"text":"Monthly","value":"{\\"months\\":1}"},'
						+ '{"text":"Quarterly","value":"{\\"months\\":3}"},'
						+ '{"text":"Half-yearly","value":"{\\"months\\":6}"},'
						+ '{"text":"Yearly","value":"{\\"years\\":1}"}]}',
					display: null,
					display_options: null,
					readonly: 0,
					hidden: 0,
					note: null,
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

		expect(await database('directus_fields'))
			.toEqual([]);
	});
});
