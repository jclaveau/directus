import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { showExamplesModule } from './show-examples-module.js';

let database: Knex;

beforeEach(async () => {
	database = knex({
		client: 'sqlite3',
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
		pool: { min: 1, max: 1 },
	});

	await database.schema.createTable('directus_settings', (table) => {
		table.increments('id');
		table.text('module_bar');
	});
});

afterEach(async () => {
	await database.destroy();
});

describe('showExamplesModule', () => {
	test('stores the default bar with the examples before Settings', async () => {
		await showExamplesModule.config.up(database);

		expect(await database('directus_settings')).toEqual([{
			id: 1,
			module_bar: '[{"type":"module","id":"content","enabled":true},'
				+ '{"type":"module","id":"visual","enabled":false},'
				+ '{"type":"module","id":"users","enabled":true},'
				+ '{"type":"module","id":"files","enabled":true},'
				+ '{"type":"module","id":"insights","enabled":true},'
				+ '{"type":"link","id":"docs","enabled":true,'
				+ '"name":"$t:documentation","icon":"help",'
				+ '"url":"https://docs.directus.io"},'
				+ '{"type":"module","id":"subscriptions-examples","enabled":true},'
				+ '{"type":"module","id":"settings","enabled":true,"locked":true}]',
		}]);
	});

	test('adds the examples to a stored bar, before Settings', async () => {
		await database('directus_settings').insert({
			module_bar: '[{"type":"module","id":"content","enabled":true},'
				+ '{"type":"module","id":"settings","enabled":true}]',
		});

		await showExamplesModule.config.up(database);

		expect(await database('directus_settings')).toEqual([{
			id: 1,
			module_bar: '[{"type":"module","id":"content","enabled":true},'
				+ '{"type":"module","id":"subscriptions-examples","enabled":true},'
				+ '{"type":"module","id":"settings","enabled":true}]',
		}]);
	});

	test('appends the examples to a bar with no Settings', async () => {
		await database('directus_settings').insert({
			module_bar: '[{"type":"module","id":"content","enabled":true}]',
		});

		await showExamplesModule.config.up(database);

		expect(await database('directus_settings')).toEqual([{
			id: 1,
			module_bar: '[{"type":"module","id":"content","enabled":true},'
				+ '{"type":"module","id":"subscriptions-examples","enabled":true}]',
		}]);
	});

	test('leaves a bar already listing the examples as it is', async () => {
		await database('directus_settings').insert({
			module_bar: '[{"type":"module","id":"subscriptions-examples",'
				+ '"enabled":false}]',
		});

		await showExamplesModule.config.up(database);

		expect(await database('directus_settings')).toEqual([{
			id: 1,
			module_bar: '[{"type":"module","id":"subscriptions-examples",'
				+ '"enabled":false}]',
		}]);
	});

	test('takes the examples out of the bar on down', async () => {
		await database('directus_settings').insert({
			module_bar: '[{"type":"module","id":"content","enabled":true},'
				+ '{"type":"module","id":"subscriptions-examples","enabled":true}]',
		});

		await showExamplesModule.config.down(database);

		expect(await database('directus_settings')).toEqual([{
			id: 1,
			module_bar: '[{"type":"module","id":"content","enabled":true}]',
		}]);
	});
});
