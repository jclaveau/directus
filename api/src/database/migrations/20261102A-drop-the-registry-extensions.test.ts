import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { down, up } from './20261102A-drop-the-registry-extensions.js';

describe('dropping the registry extensions', () => {
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
				id: 'local-hook',
				enabled: true,
				folder: 'hook',
				source: 'local',
				bundle: null,
			},
			{
				id: 'module-bundle',
				enabled: true,
				folder: 'pkg',
				source: 'module',
				bundle: null,
			},
			{
				id: 'module-entry',
				enabled: true,
				folder: 'entry',
				source: 'module',
				bundle: 'module-bundle',
			},
			{
				id: 'registry-hook',
				enabled: true,
				folder: 'version-a',
				source: 'registry',
				bundle: null,
			},
			{
				id: 'registry-bundle',
				enabled: true,
				folder: 'version-b',
				source: 'registry',
				bundle: null,
			},
			{
				id: 'registry-entry',
				enabled: true,
				folder: 'entry',
				source: 'registry',
				bundle: 'registry-bundle',
			},
			{
				id: 'stray-entry',
				enabled: true,
				folder: 'other',
				source: 'local',
				bundle: 'registry-bundle',
			},
		]);
	});

	afterEach(async () => {
		await database.destroy();
	});

	it('deletes the registry rows and every entry of a registry bundle', async () => {
		await up(database);

		await expect(database('directus_extensions')
			.select('id')
			.orderBy('id'))
			.resolves.toStrictEqual([
				{ id: 'local-hook' },
				{ id: 'module-bundle' },
				{ id: 'module-entry' },
			]);
	});

	it('leaves the rows as they are on the way down', async () => {
		await up(database);
		await down(database);

		await expect(database('directus_extensions')
			.select('id')
			.orderBy('id'))
			.resolves.toStrictEqual([
				{ id: 'local-hook' },
				{ id: 'module-bundle' },
				{ id: 'module-entry' },
			]);
	});
});
