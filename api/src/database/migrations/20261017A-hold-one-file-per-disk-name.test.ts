import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { down, up } from './20261017A-hold-one-file-per-disk-name.js';

describe('holding one file per disk name', () => {
	let database: Knex;

	beforeEach(async () => {
		database = knex({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
			pool: { min: 1, max: 1 },
		});

		await database.schema.createTable('directus_files', (table) => {
			table.uuid('id').primary();
			table.string('filename_disk');
		});
	});

	afterEach(async () => {
		await database.destroy();
	});

	it('refuses a second row for one disk name', async () => {
		await database('directus_files').insert([
			{ id: 'a', filename_disk: 'a.jpg' },
			{ id: 'b', filename_disk: 'b.jpg' },
		]);

		await up(database);

		await expect(database('directus_files').insert({
			id: 'c',
			filename_disk: 'a.jpg',
		})).rejects.toThrow(
			'UNIQUE constraint failed: directus_files.filename_disk',
		);
	});

	it('lets several rows hold no disk name', async () => {
		await up(database);

		await database('directus_files').insert([
			{ id: 'a', filename_disk: null },
			{ id: 'b', filename_disk: null },
		]);

		await expect(database('directus_files').count('* as rows'))
			.resolves.toStrictEqual([{ rows: 2 }]);
	});

	it('refuses to run over duplicates, naming each one', async () => {
		await database('directus_files').insert([
			{ id: 'a', filename_disk: 'b.jpg' },
			{ id: 'b', filename_disk: 'b.jpg' },
			{ id: 'e', filename_disk: 'a.jpg' },
			{ id: 'c', filename_disk: 'a.jpg' },
			{ id: 'd', filename_disk: 'a.jpg' },
			{ id: 'f', filename_disk: 'c.jpg' },
			{ id: 'g', filename_disk: null },
			{ id: 'h', filename_disk: null },
		]);

		await expect(up(database)).rejects.toStrictEqual(new Error(
			'directus_files holds more than one file for the disk name'
			+ ' "a.jpg" (rows c, d, e), "b.jpg" (rows a, b).'
			+ ' Give each extra row its own file, or delete it, then run the'
			+ ' migrations again.',
		));

		await expect(database('directus_files').count('* as rows'))
			.resolves.toStrictEqual([{ rows: 8 }]);
	});

	it('lets duplicates in again on the way down', async () => {
		await up(database);
		await down(database);

		await database('directus_files').insert([
			{ id: 'a', filename_disk: 'a.jpg' },
			{ id: 'b', filename_disk: 'a.jpg' },
		]);

		await expect(database('directus_files').count('* as rows'))
			.resolves.toStrictEqual([{ rows: 2 }]);
	});
});
