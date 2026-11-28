import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createParkedSyncsPreset } from './create-parked-syncs-preset.js';

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
	});

	await database.schema.createTable('directus_presets', (table) => {
		table.string('bookmark');
		table.string('collection');
		table.string('layout');
		table.text('layout_query');
		table.text('filter');
		table.string('icon');
	});

	await database('directus_collections')
		.insert({ collection: 'other', icon: null });

	await database('directus_presets').insert({
		bookmark: 'Parked syncs',
		collection: 'other',
		layout: null,
		layout_query: null,
		filter: null,
		icon: null,
	});
});

afterEach(async () => {
	await database.destroy();
});

describe('createParkedSyncsPreset', () => {
	test('bookmarks the syncs at the attempt ceiling, for every user', async () => {
		await createParkedSyncsPreset.config.up(database);

		expect(await database('directus_collections')
			.where('collection', 'subscription_sync_queue'))
			.toEqual([{
				collection: 'subscription_sync_queue',
				icon: 'sync_problem',
			}]);

		expect(await database('directus_presets')
			.where('collection', 'subscription_sync_queue'))
			.toEqual([{
				bookmark: 'Parked syncs',
				collection: 'subscription_sync_queue',
				layout: 'tabular',
				layout_query: '{"tabular":{"fields":["provider","resource_id",'
					+ '"attempts","next_attempt_at","last_error"],'
					+ '"sort":["-next_attempt_at"]}}',
				filter: '{"_and":[{"attempts":{"_gte":48}}]}',
				icon: 'sync_problem',
			}]);
	});

	test('removes its own rows and no other', async () => {
		await createParkedSyncsPreset.config.up(database);
		await createParkedSyncsPreset.config.down(database);

		expect(await database('directus_collections').pluck('collection'))
			.toEqual(['other']);

		expect(await database('directus_presets').pluck('collection'))
			.toEqual(['other']);
	});
});
