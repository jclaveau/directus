import { ForbiddenError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability, RawField } from '@directus/types';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import type { Tracker } from 'knex-mock-client';
import { FieldsService } from './fields.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

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
});
