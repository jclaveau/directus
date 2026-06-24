import { ForbiddenError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability } from '@directus/types';
import knex from 'knex';
import type { Knex } from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fetchAllowedFields } from '../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js';
import { validateAccess } from '../permissions/modules/validate-access/validate-access.js';
import { ItemsService } from './items.js';
import { RelationsService } from './relations.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('../permissions/modules/validate-access/validate-access.js', () => ({
	validateAccess: vi.fn(),
}));

vi.mock('../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js', () => ({
	fetchAllowedFields: vi.fn(),
}));

const schema = new SchemaBuilder()
	.collection('test', (c) => {
		c.field('id').uuid().primary();
		c.field('related').m2o('related');
	})
	.collection('related', (c) => {
		c.field('id').uuid().primary();
	})
	.build();

const nonAdmin = { role: 'test', admin: false, user: 'test-user' } as Accountability;
const admin = { role: 'admin', admin: true, user: 'admin-user' } as Accountability;

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

describe('Services / Relations', () => {
	describe('createOne', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new RelationsService({ knex: db, schema, accountability: nonAdmin });

			await expect(service.createOne({ collection: 'test', field: 'related' })).rejects.toThrowError(ForbiddenError);

			await expect(service.createOne({ collection: 'test', field: 'related' })).rejects.toThrowError(
				`'test-user' is not allowed to create a relation`,
			);
		});
	});

	describe('updateOne', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new RelationsService({ knex: db, schema, accountability: nonAdmin });

			await expect(service.updateOne('test', 'related', {})).rejects.toThrowError(ForbiddenError);

			await expect(service.updateOne('test', 'related', {})).rejects.toThrowError(
				`'test-user' is not allowed to update a relation`,
			);
		});
	});

	describe('deleteOne', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new RelationsService({ knex: db, schema, accountability: nonAdmin });

			await expect(service.deleteOne('test', 'related')).rejects.toThrowError(ForbiddenError);

			await expect(service.deleteOne('test', 'related')).rejects.toThrowError(
				`'test-user' is not allowed to delete a relation`,
			);
		});
	});

	describe('readOne', () => {
		it('should throw ForbiddenError when non-admin lacks field read permission', async () => {
			vi.mocked(validateAccess).mockResolvedValue(undefined);
			vi.mocked(fetchAllowedFields).mockResolvedValue(['id']);

			const service = new RelationsService({ knex: db, schema, accountability: nonAdmin });

			await expect(service.readOne('test', 'related')).rejects.toThrowError(ForbiddenError);

			await expect(service.readOne('test', 'related')).rejects.toThrowError(
				`'test-user' has no permission to read the field 'related' of 'test'`,
			);
		});

		it('should throw ForbiddenError when no relation is found', async () => {
			vi.spyOn(ItemsService.prototype, 'readByQuery').mockResolvedValue([]);
			vi.spyOn(RelationsService.prototype, 'foreignKeys').mockResolvedValue([]);

			const service = new RelationsService({ knex: db, schema, accountability: admin });

			await expect(service.readOne('test', 'related')).rejects.toThrowError(ForbiddenError);

			await expect(service.readOne('test', 'related')).rejects.toThrowError(
				`No result found for relation test.related during items.readOne()`,
			);
		});
	});
});
