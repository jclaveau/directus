import { ForbiddenError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability, RawField } from '@directus/types';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import type { Tracker } from 'knex-mock-client';
import emitter from '../emitter.js';
import { readMeta, withMeta } from '../utils/read-meta.js';
import { FieldsService } from './fields.js';
import { ItemsService } from './items.js';
import { RelationsService } from './relations.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('../utils/get-schema.js', () => ({ getSchema: vi.fn() }));

const schema = new SchemaBuilder()
	.collection('test', (c) => {
		c.field('id').uuid().primary();
	})
	.build();

const nonAdmin = { role: 'test', user: 'user-1', admin: false } as Accountability;
const admin = { role: 'admin', user: 'admin-1', admin: true } as Accountability;

class Client_PG extends MockClient {}

let db: Knex;
let tracker: Tracker;

beforeAll(() => {
	db = knex.default({ client: Client_PG });
	tracker = createTracker(db);
});

afterEach(() => {
	tracker.reset();
	vi.clearAllMocks();
});

describe('Services / Fields', () => {
	describe('createField', () => {
		it('throws ForbiddenError for non-admin user', async () => {
			const service = new FieldsService({ knex: db, schema, accountability: nonAdmin });

			const promise = service.createField('test', { field: 'foo', type: 'string' });

			await expect(promise).rejects.toThrowError(ForbiddenError);

			await expect(service.createField('test', { field: 'foo', type: 'string' })).rejects.toThrowError(
				'does not have the permission to create the field',
			);
		});
	});

	describe('updateField', () => {
		it('throws ForbiddenError for non-admin user', async () => {
			const service = new FieldsService({ knex: db, schema, accountability: nonAdmin });

			const field = { field: 'foo', type: 'string' } as RawField;

			await expect(service.updateField('test', field)).rejects.toThrowError(ForbiddenError);

			await expect(service.updateField('test', field)).rejects.toThrowError(
				'does not have the permission to update the field',
			);
		});

		it('rejects with the error the column builder throws', async () => {
			vi.spyOn(FieldsService.prototype, 'columnInfo').mockResolvedValueOnce({
				name: 'title',
				table: 'test',
				data_type: 'varchar',
			} as any);

			const service = new FieldsService({ knex: db, schema, accountability: admin });

			const promise = service.updateField(
				'test',
				{ field: 'title', type: 'illegal', schema: { is_nullable: true } } as any,
				{ emitEvents: false, autoPurgeCache: false, autoPurgeSystemCache: false },
			);

			await expect(promise).rejects.toThrowError(
				'Invalid payload. Illegal type passed: "illegal".',
			);
		});
	});

	describe('deleteField', () => {
		it('throws ForbiddenError for non-admin user', async () => {
			const service = new FieldsService({ knex: db, schema, accountability: nonAdmin });

			await expect(service.deleteField('test', 'foo')).rejects.toThrowError(ForbiddenError);

			await expect(service.deleteField('test', 'foo')).rejects.toThrowError(
				'does not have the permission to delete the field',
			);
		});
	});

	describe('deleteField that rolled back', () => {
		it('fires no action of its nested relation delete', async () => {
			const emitActionSpy = vi
				.spyOn(emitter, 'emitAction')
				.mockResolvedValue(undefined);

			vi.spyOn(RelationsService.prototype, 'deleteOne')
				.mockImplementationOnce(async (_collection, _field, opts) => {
					opts!.bypassEmitAction!({
						event: 'relations.delete',
						meta: {},
						context: {},
					} as any);
				});

			tracker.on.any(/alter table/).simulateError('column refused');

			const service = new FieldsService({
				knex: db,
				schema: new SchemaBuilder()
					.collection('articles', (c) => {
						c.field('id')
							.uuid()
							.primary();

						c.field('author').m2o('authors');
					})
					.collection('authors', (c) => {
						c.field('id')
							.uuid()
							.primary();
					})
					.build(),
				accountability: admin,
			});

			await expect(service.deleteField('articles', 'author'))
				.rejects.toThrow('column refused');

			expect(emitActionSpy).not.toHaveBeenCalled();
		});
	});

	describe('readOne', () => {
		it('throws ForbiddenError when schema info cannot be retrieved', async () => {
			tracker.on.select('directus_fields').response([]);

			const service = new FieldsService({ knex: db, schema, accountability: admin });

			await expect(service.readOne('test', 'nonexistent')).rejects.toThrowError(ForbiddenError);

			await expect(service.readOne('test', 'nonexistent')).rejects.toThrowError(
				"Can't retrieve the schema info for the column 'nonexistent' of 'test'",
			);
		});
	});

	// Last, since the spies below survive clearAllMocks and would otherwise leak the
	// stubbed columnInfo into readOne (which needs the real one to throw).
	describe('readAll', () => {
		it('pins the result with directus_fields', async () => {
			vi.spyOn(ItemsService.prototype, 'readByQuery')
				.mockResolvedValue(withMeta([], { scopedCacheFingerprints: [] }));

			vi.spyOn(FieldsService.prototype, 'columnInfo').mockResolvedValue([]);

			tracker.on.select('directus_fields').response([]);

			const service = new FieldsService({ knex: db, schema });
			const result = await service.readAll();

			expect(readMeta(result)?.scopedCacheFingerprints).toEqual([
				{ collection: 'directus_fields' },
			]);
		});

		it('reads only the field rows of the given collection', async () => {
			const readByQuery = vi
				.spyOn(ItemsService.prototype, 'readByQuery')
				.mockResolvedValue(withMeta([], { scopedCacheFingerprints: [] }));

			vi.spyOn(FieldsService.prototype, 'columnInfo').mockResolvedValue([]);

			tracker.on.select('directus_fields').response([]);

			const service = new FieldsService({ knex: db, schema });
			await service.readAll('test');

			expect(readByQuery).toHaveBeenCalledWith({
				filter: { collection: { _eq: 'test' } },
				limit: -1,
			});
		});
	});
});
