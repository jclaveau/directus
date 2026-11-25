import { oneLine } from '@directus/utils';
import { InvalidPayloadError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldsService } from './fields.js';
import { RelationsService } from './relations.js';

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('sqlite'),
		getSchemaInspector: vi.fn(),
	};
});

vi.mock('../cache.js', () => {
	return {
		getCache: vi.fn().mockReturnValue({
			cache: null,
			systemCache: null,
			localSchemaCache: null,
			lockCache: null,
		}),
		getCacheValue: vi.fn(),
		setCacheValue: vi.fn(),
		clearSystemCache: vi.fn(),
	};
});

vi.mock('../utils/get-schema.js', () => ({ getSchema: vi.fn() }));

vi.mock('../utils/transaction.js', () => {
	return {
		transaction: vi.fn((trxKnex, runInTransaction) => runInTransaction(trxKnex)),
	};
});

const schema = new SchemaBuilder()
	.collection('pin_owner', (c) => {
		c.field('id').id();
		c.field('owned_items').o2m('pin_item', 'owner');

		c.field('note_items')
			.string()
			.options({ alias: true });
	})
	.collection('pin_item', (c) => {
		c.field('id').id();
		c.field('owner').integer();
	})
	.collection('directus_fields', (c) => {
		c.field('id').id();
		c.field('collection').string();
		c.field('field').string();
		c.field('special').csv();
		c.field('sort').integer();
		c.field('group').string();
	})
	.collection('directus_relations', (c) => {
		c.field('id').id();
		c.field('many_collection').string();
		c.field('many_field').string();
		c.field('one_collection').string();
		c.field('one_field').string();
		c.field('one_deselect_action').string();
	})
	.build();

schema.collections['directus_fields']!.accountability = null;
schema.collections['directus_relations']!.accountability = null;
schema.relations[0]!.schema = null;
schema.relations[0]!.meta!.id = 1;

describe('Services / relational aliases a relation names', () => {
	let database: Knex;

	beforeEach(async () => {
		database = knex.default({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
			pool: { min: 1, max: 1 },
		});

		await database.schema.createTable('pin_owner', (table) => {
			table.increments('id');
		});

		await database.schema.createTable('pin_item', (table) => {
			table.increments('id');
			table.integer('owner');
		});

		await database.schema.createTable('directus_fields', (table) => {
			table.increments('id');
			table.string('collection');
			table.string('field');
			table.string('special');
			table.integer('sort');
			table.string('group');
		});

		await database.schema.createTable('directus_relations', (table) => {
			table.increments('id');
			table.string('many_collection');
			table.string('many_field');
			table.string('one_collection');
			table.string('one_field');
			table.string('one_deselect_action');
		});

		await database.schema.createTable('directus_collections', (table) => {
			table.string('collection');
			table.string('archive_field');
			table.string('sort_field');
			table.string('item_duplication_fields');
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await database.destroy();
	});

	describe('FieldsService.createField', () => {
		it('refuses an o2m alias no relation names', async () => {
			const service = new FieldsService({ knex: database, schema });

			await expect(service.createField('pin_owner', {
				field: 'loose_items',
				type: 'alias',
				meta: { special: ['o2m'] },
			} as any)).rejects.toEqual(new InvalidPayloadError({
				reason: 'Field "loose_items" of "pin_owner" is an o2m alias no'
					+ ' relation names in one_field',
			}));

			await expect(database('directus_fields').select('field'))
				.resolves.toEqual([]);
		});

		it('refuses a translations alias of a null type, with its article', async () => {
			const service = new FieldsService({ knex: database, schema });

			await expect(service.createField('pin_owner', {
				field: 'loose_translations',
				type: null,
				meta: { special: 'translations' },
			} as any)).rejects.toEqual(new InvalidPayloadError({
				reason: 'Field "loose_translations" of "pin_owner" is a translations'
					+ ' alias no relation names in one_field',
			}));
		});

		it('creates an o2m alias a relation names', async () => {
			await database('directus_relations').insert({
				many_collection: 'pin_item',
				many_field: 'owner',
				one_collection: 'pin_owner',
				one_field: 'named_items',
			});

			const service = new FieldsService({ knex: database, schema });

			await service.createField('pin_owner', {
				field: 'named_items',
				type: 'alias',
				meta: { special: ['o2m'] },
			} as any);

			await expect(database('directus_fields')
				.select('collection', 'field', 'special'))
				.resolves.toEqual([
					{ collection: 'pin_owner', field: 'named_items', special: 'o2m' },
				]);
		});
	});

	describe('FieldsService.updateField', () => {
		it('refuses to turn an alias into an m2m alias no relation names', async () => {
			await database('directus_fields').insert({
				collection: 'pin_owner',
				field: 'note_items',
				special: 'alias,no-data',
			});

			const service = new FieldsService({ knex: database, schema });

			await expect(service.updateField('pin_owner', {
				field: 'note_items',
				meta: { special: ['m2m'] },
			} as any)).rejects.toEqual(new InvalidPayloadError({
				reason: 'Field "note_items" of "pin_owner" is an m2m alias no'
					+ ' relation names in one_field',
			}));

			await expect(database('directus_fields').select('special'))
				.resolves.toEqual([{ special: 'alias,no-data' }]);
		});
	});

	describe('RelationsService', () => {
		beforeEach(async () => {
			await database('directus_relations').insert({
				id: 1,
				many_collection: 'pin_item',
				many_field: 'owner',
				one_collection: 'pin_owner',
				one_field: 'owned_items',
			});

			await database('directus_fields').insert({
				collection: 'pin_owner',
				field: 'owned_items',
				special: 'o2m',
			});
		});

		it('deleteOne deletes the alias its one_field named', async () => {
			const service = new RelationsService({ knex: database, schema });

			await service.deleteOne('pin_item', 'owner');

			await expect(database('directus_fields').select('field'))
				.resolves.toEqual([]);

			await expect(database('directus_relations').select('id'))
				.resolves.toEqual([]);
		});

		it('updateOne clearing one_field deletes the alias it named', async () => {
			const service = new RelationsService({ knex: database, schema });

			await service.updateOne('pin_item', 'owner', {
				meta: { one_field: null },
			} as any);

			await expect(database('directus_fields').select('field'))
				.resolves.toEqual([]);

			await expect(database('directus_relations').select('one_field'))
				.resolves.toEqual([{ one_field: null }]);
		});

		it('updateOne renaming one_field renames the alias it named', async () => {
			const service = new RelationsService({ knex: database, schema });

			await service.updateOne('pin_item', 'owner', {
				meta: { one_field: 'kept_items' },
			} as any);

			await expect(database('directus_fields').select('collection', 'field'))
				.resolves.toEqual([{ collection: 'pin_owner', field: 'kept_items' }]);

			await expect(database('directus_relations').select('one_field'))
				.resolves.toEqual([{ one_field: 'kept_items' }]);
		});

		it(oneLine`
			updateOne refuses to rename one_field onto a field that exists
		`, async () => {
			await database('directus_fields').insert({
				collection: 'pin_owner',
				field: 'kept_items',
				special: 'alias,no-data',
			});

			const service = new RelationsService({ knex: database, schema });

			await expect(service.updateOne('pin_item', 'owner', {
				meta: { one_field: 'kept_items' },
			} as any)).rejects.toEqual(new InvalidPayloadError({
				reason: 'Field "kept_items" of "pin_owner" already exists, so'
					+ ' one_field cannot name it in place of "owned_items"',
			}));

			await expect(database('directus_relations').select('one_field'))
				.resolves.toEqual([{ one_field: 'owned_items' }]);
		});

		it('updateOne leaves the alias alone when one_field is left out', async () => {
			const service = new RelationsService({ knex: database, schema });

			await service.updateOne('pin_item', 'owner', {
				meta: { one_deselect_action: 'delete' },
			} as any);

			await expect(database('directus_fields').select('field'))
				.resolves.toEqual([{ field: 'owned_items' }]);
		});
	});
});
