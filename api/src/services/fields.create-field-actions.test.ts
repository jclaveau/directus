import { SchemaBuilder } from '@directus/schema-builder';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import emitter from '../emitter.js';
import { transaction } from '../utils/transaction.js';
import { FieldsService } from './fields.js';

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
	.collection('test', (c) => {
		c.field('id').id();
	})
	.collection('directus_fields', (c) => {
		c.field('id').id();
		c.field('collection').string();
		c.field('field').string();
		c.field('type').string();
		c.field('special').csv();
		c.field('sort').integer();
		c.field('group').string();
	})
	.collection('directus_activity', (c) => {
		c.field('id').id();
		c.field('action').string();
		c.field('user').string();
		c.field('collection').string();
		c.field('item').string();
		c.field('ip').string();
		c.field('user_agent').string();
		c.field('origin').string();
	})
	.build();

schema.collections['directus_fields']!.accountability = 'activity';

const adminAccountability = {
	user: 'u1',
	role: null,
	roles: [],
	admin: true,
	app: true,
	ip: null,
} as any;

describe('Services / Fields / createField actions', () => {
	let database: Knex;

	beforeEach(async () => {
		database = knex.default({
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
			table.integer('sort');
			table.string('group');
		});

		await database.schema.createTable('directus_activity', (table) => {
			table.increments('id');
			table.string('action');
			table.string('user');
			table.string('collection');
			table.string('item');
			table.string('ip');
			table.string('user_agent');
			table.string('origin');
			table.timestamp('timestamp');
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

	it('fires no action when the commit fails', async () => {
		const emitAction = vi.spyOn(emitter, 'emitAction').mockResolvedValue(undefined);

		vi.mocked(transaction).mockImplementationOnce(async (trxKnex, runHandler) => {
			await runHandler(trxKnex);

			throw new Error('commit failed');
		});

		const service = new FieldsService({
			knex: database,
			schema,
			accountability: null,
		});

		await expect(service.createField(
			'test',
			{ field: 'alias_field', type: 'alias', meta: { special: ['no-data'] } } as any,
			undefined,
			{ autoPurgeSystemCache: false },
		)).rejects.toEqual(new Error('commit failed'));

		expect(emitAction).not.toHaveBeenCalled();
	});

	it('fires no activity action of its field row when the commit fails', async () => {
		const emitAction = vi.spyOn(emitter, 'emitAction').mockResolvedValue(undefined);

		vi.mocked(transaction).mockImplementationOnce(async (trxKnex, runHandler) => {
			await runHandler(trxKnex);

			throw new Error('commit failed');
		});

		const service = new FieldsService({
			knex: database,
			schema,
			accountability: adminAccountability,
		});

		await expect(service.createField(
			'test',
			{ field: 'alias_field', type: 'alias', meta: { special: ['no-data'] } } as any,
			undefined,
			{ autoPurgeSystemCache: false },
		)).rejects.toEqual(new Error('commit failed'));

		expect(emitAction).not.toHaveBeenCalled();
	});

	it(
		'hands the activity action of its field row to the caller holding them',
		async () => {
			const emitAction = vi.spyOn(emitter, 'emitAction')
				.mockResolvedValue(undefined);

			const service = new FieldsService({
				knex: database,
				schema,
				accountability: adminAccountability,
			});

			await service.updateField(
				'test',
				{
					field: 'alias_field',
					type: 'alias',
					meta: { special: ['no-data'] },
				} as any,
				{ autoPurgeSystemCache: false, bypassEmitAction: vi.fn() },
			);

			expect(emitAction).not.toHaveBeenCalled();
		},
	);

	it(
		'hands the activity action of its updated field row to the caller holding them',
		async () => {
			await database('directus_fields')
				.insert({ collection: 'test', field: 'alias_field' });

			const emitAction = vi.spyOn(emitter, 'emitAction')
				.mockResolvedValue(undefined);

			const service = new FieldsService({
				knex: database,
				schema,
				accountability: adminAccountability,
			});

			await service.updateField(
				'test',
				{
					field: 'alias_field',
					type: 'alias',
					meta: { special: ['no-data'] },
				} as any,
				{ autoPurgeSystemCache: false, bypassEmitAction: vi.fn() },
			);

			expect(emitAction).not.toHaveBeenCalled();
		},
	);

	it(
		'fires no activity action of its deleted field row when the commit fails',
		async () => {
			await database('directus_fields')
				.insert({ collection: 'test', field: 'alias_field' });

			const emitAction = vi.spyOn(emitter, 'emitAction')
				.mockResolvedValue(undefined);

			vi.mocked(transaction).mockImplementationOnce(async (trxKnex, runHandler) => {
				await runHandler(trxKnex);

				throw new Error('commit failed');
			});

			const service = new FieldsService({
				knex: database,
				schema,
				accountability: adminAccountability,
			});

			await expect(service.deleteField(
				'test',
				'alias_field',
				{ autoPurgeSystemCache: false },
			)).rejects.toEqual(new Error('commit failed'));

			expect(emitAction).not.toHaveBeenCalled();
		},
	);

	it('fires the action of the attempt that committed, once', async () => {
		const emitAction = vi.spyOn(emitter, 'emitAction').mockResolvedValue(undefined);

		vi.mocked(transaction).mockImplementationOnce(async (trxKnex, runHandler) => {
			await runHandler(trxKnex);

			return runHandler(trxKnex);
		});

		const service = new FieldsService({
			knex: database,
			schema,
			accountability: null,
		});

		await service.createField(
			'test',
			{ field: 'alias_field', type: 'alias', meta: { special: ['no-data'] } } as any,
			undefined,
			{ autoPurgeSystemCache: false },
		);

		expect(emitAction).toHaveBeenCalledExactlyOnceWith(
			'fields.create',
			{
				payload: {
					field: 'alias_field',
					type: 'alias',
					meta: { special: ['no-data'] },
				},
				key: 'alias_field',
				collection: 'test',
			},
			{
				database: undefined,
				schema: undefined,
				accountability: null,
			},
		);
	});
});
