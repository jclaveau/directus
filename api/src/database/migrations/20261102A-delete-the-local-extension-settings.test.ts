import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { down, up } from './20261102A-delete-the-local-extension-settings.js';

describe('deleting the local extension settings', () => {
	let database: Knex;

	beforeEach(async () => {
		database = knex({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
			pool: { min: 1, max: 1 },
		});

		await database.schema.createTable('directus_extensions', (table) => {
			table.uuid('id').primary();
			table.boolean('enabled');
			table.string('folder');
			table.string('source');
			table.uuid('bundle');
		});

		await database('directus_extensions').insert([
			{
				id: 'a',
				enabled: true,
				folder: 'local-hook',
				source: 'local',
				bundle: null,
			},
			{
				id: 'b',
				enabled: true,
				folder: 'local-bundle',
				source: 'local',
				bundle: null,
			},
			{
				id: 'c',
				enabled: false,
				folder: 'bundle-entry',
				source: 'local',
				bundle: 'b',
			},
			{
				id: 'd',
				enabled: true,
				folder: 'module-bundle',
				source: 'module',
				bundle: null,
			},
			{
				id: 'e',
				enabled: true,
				folder: 'bundle-entry',
				source: 'module',
				bundle: 'd',
			},
			{
				id: 'f',
				enabled: true,
				folder: 'registry-uuid',
				source: 'registry',
				bundle: null,
			},
		]);
	});

	afterEach(async () => {
		await database.destroy();
	});

	it('deletes the local rows and their bundle entries', async () => {
		await up(database);

		const remainingRows = await database('directus_extensions')
			.select('id')
			.orderBy('id');

		expect(remainingRows).toStrictEqual([{ id: 'd' }, { id: 'e' }, { id: 'f' }]);
	});

	it('leaves the rows as they are on the way down', async () => {
		await up(database);
		await down(database);

		const remainingRows = await database('directus_extensions')
			.select('id')
			.orderBy('id');

		expect(remainingRows).toStrictEqual([{ id: 'd' }, { id: 'e' }, { id: 'f' }]);
	});
});
