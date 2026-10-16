import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	down,
	up,
} from './20261016A-hold-one-translation-per-key-and-language.js';

describe('holding one translation per key and language', () => {
	let database: Knex;

	beforeEach(async () => {
		database = knex({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
			pool: { min: 1, max: 1 },
		});

		await database.schema.createTable('directus_translations', (table) => {
			table.uuid('id').primary();
			table.string('language').notNullable();
			table.string('key').notNullable();
			table.text('value').notNullable();
		});
	});

	afterEach(async () => {
		await database.destroy();
	});

	it('refuses a second row for one key and language', async () => {
		await database('directus_translations').insert([
			{ id: 'a', key: 'greeting', language: 'en-US', value: 'hello' },
			{ id: 'b', key: 'greeting', language: 'fr-FR', value: 'bonjour' },
		]);

		await up(database);

		await expect(database('directus_translations').insert({
			id: 'c',
			key: 'greeting',
			language: 'en-US',
			value: 'hi',
		})).rejects.toThrow(
			'UNIQUE constraint failed: directus_translations.key,'
			+ ' directus_translations.language',
		);
	});

	it('refuses to run over duplicates, naming each one', async () => {
		await database('directus_translations').insert([
			{ id: 'a', key: 'greeting', language: 'en-US', value: 'hello' },
			{ id: 'b', key: 'greeting', language: 'en-US', value: 'hi' },
			{ id: 'e', key: 'farewell', language: 'fr-FR', value: 'adieu' },
			{ id: 'c', key: 'farewell', language: 'fr-FR', value: 'salut' },
			{ id: 'd', key: 'farewell', language: 'fr-FR', value: 'ciao' },
			{ id: 'f', key: 'farewell', language: 'en-US', value: 'bye' },
		]);

		await expect(up(database)).rejects.toStrictEqual(new Error(
			'directus_translations holds more than one translation for'
			+ ' "farewell" in "fr-FR" (rows c, d, e),'
			+ ' "greeting" in "en-US" (rows a, b).'
			+ ' Delete the extra rows, then run the migrations again.',
		));

		await expect(database('directus_translations').count('* as rows'))
			.resolves.toStrictEqual([{ rows: 6 }]);
	});

	it('lets duplicates in again on the way down', async () => {
		await up(database);
		await down(database);

		await database('directus_translations').insert([
			{ id: 'a', key: 'greeting', language: 'en-US', value: 'hello' },
			{ id: 'b', key: 'greeting', language: 'en-US', value: 'hi' },
		]);

		await expect(database('directus_translations').count('* as rows'))
			.resolves.toStrictEqual([{ rows: 2 }]);
	});
});
