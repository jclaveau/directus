import { oneLine } from '@directus/utils';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	down,
	up,
} from './20261125A-delete-the-relational-aliases-no-relation-names.js';

const dialect = vi.hoisted(() => ({ client: 'sqlite' }));

vi.mock('../index.js', () => {
	return { getDatabaseClient: () => dialect.client };
});

describe('deleting the relational aliases no relation names', () => {
	let database: Knex;

	beforeEach(async () => {
		dialect.client = 'sqlite';

		database = knex({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
			pool: { min: 1, max: 1 },
		});

		await database.schema.createTable('directus_fields', (table) => {
			table.increments('id');
			table.string('collection');
			table.string('field');
			table.string('special');
		});

		await database.schema.createTable('directus_relations', (table) => {
			table.increments('id');
			table.string('one_collection');
			table.string('one_field');
		});
	});

	afterEach(async () => {
		await database.destroy();
	});

	it(oneLine`
		deletes the relational aliases no relation names, and only those
	`, async () => {
		await database('directus_relations').insert([
			{ one_collection: 'pin_owner', one_field: 'owned_items' },
			{ one_collection: 'pin_owner', one_field: null },
		]);

		await database('directus_fields').insert([
			{ collection: 'pin_owner', field: 'owned_items', special: 'o2m' },
			{ collection: 'pin_owner', field: 'loose_items', special: 'o2m' },
			{ collection: 'pin_owner', field: 'loose_tags', special: 'cast-json,m2m' },
			{ collection: 'pin_other', field: 'owned_items', special: 'translations' },
			{ collection: 'pin_owner', field: 'divider', special: 'alias,no-data' },
			{ collection: 'pin_owner', field: 'title', special: null },
		]);

		await up(database);

		await expect(database('directus_fields').select('collection', 'field')
.orderBy('id'))
			.resolves.toEqual([
				{ collection: 'pin_owner', field: 'owned_items' },
				{ collection: 'pin_owner', field: 'divider' },
				{ collection: 'pin_owner', field: 'title' },
			]);
	});

	it('refuses an alias two relations name, naming each one', async () => {
		await database('directus_relations').insert([
			{ id: 3, one_collection: 'pin_owner', one_field: 'owned_items' },
			{ id: 7, one_collection: 'pin_owner', one_field: 'owned_items' },
			{ id: 8, one_collection: 'pin_owner', one_field: null },
			{ id: 9, one_collection: 'pin_owner', one_field: null },
			{ id: 4, one_collection: 'pin_box', one_field: 'boxed' },
			{ id: 5, one_collection: 'pin_box', one_field: 'boxed' },
		]);

		await database('directus_fields').insert([
			{ collection: 'pin_owner', field: 'loose_items', special: 'o2m' },
		]);

		await expect(up(database)).rejects.toEqual(new Error(
			'directus_relations names more than once in one_field the alias'
			+ ' field "boxed" of "pin_box" (rows 4, 5),'
			+ ' field "owned_items" of "pin_owner" (rows 3, 7).'
			+ ' Keep one relation per alias, clear one_field on the others, then run'
			+ ' the migrations again.',
		));

		await expect(database('directus_fields').select('field'))
			.resolves.toEqual([{ field: 'loose_items' }]);
	});

	it(oneLine`
		holds one relation per alias on postgres, and lets go on the way down
	`, async () => {
		dialect.client = 'postgres';

		await up(database);

		await database('directus_relations').insert({
			one_collection: 'pin_owner',
			one_field: 'owned_items',
		});

		await expect(database('directus_relations').insert({
			one_collection: 'pin_owner',
			one_field: 'owned_items',
		})).rejects.toThrow(
			'UNIQUE constraint failed: directus_relations.one_collection,'
			+ ' directus_relations.one_field',
		);

		await down(database);

		await database('directus_relations').insert({
			one_collection: 'pin_owner',
			one_field: 'owned_items',
		});

		await expect(database('directus_relations').count('* as rows'))
			.resolves.toEqual([{ rows: 2 }]);
	});

	it('leaves the other dialects without the unique key', async () => {
		await up(database);

		await database('directus_relations').insert([
			{ one_collection: 'pin_owner', one_field: 'owned_items' },
			{ one_collection: 'pin_owner', one_field: 'owned_items' },
		]);

		await down(database);

		await expect(database('directus_relations').count('* as rows'))
			.resolves.toEqual([{ rows: 2 }]);
	});
});
