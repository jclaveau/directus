import { ForbiddenError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability } from '@directus/types';
import type { Knex } from 'knex';
import knex from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CollectionsService } from './collections.js';

vi.mock('directus/version', () => ({ version: '0.0.0' }));

vi.mock('../../src/database/index.js', () => {
	return { __esModule: true, default: vi.fn(), getDatabaseClient: vi.fn().mockReturnValue('postgres') };
});

vi.mock('../database/helpers/index.js', () => ({
	getHelpers: vi.fn().mockReturnValue({}),
}));

vi.mock('@directus/schema', () => ({
	createInspector: vi.fn().mockReturnValue({}),
}));

const schema = new SchemaBuilder()
	.collection('directus_collections', (c) => {
		c.field('collection').string().primary();
	})
	.build();

let db: Knex;
let tracker: Tracker;

beforeAll(() => {
	db = knex.default({ client: MockClient });
	tracker = createTracker(db);
});

afterEach(() => {
	tracker.reset();
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

const nonAdmin = { role: 'test', admin: false, user: 'test-user' } as Accountability;

describe('Services / Collections', () => {
	describe('createOne', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new CollectionsService({ knex: db, schema, accountability: nonAdmin });

			await expect(service.createOne({ collection: 'x' } as any)).rejects.toThrowError(ForbiddenError);

			await expect(service.createOne({ collection: 'x' } as any)).rejects.toThrowError(
				`'test-user' can't create the collection 'x' as it's not an admin`,
			);
		});
	});

	describe('updateOne', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new CollectionsService({ knex: db, schema, accountability: nonAdmin });

			await expect(service.updateOne('x', {})).rejects.toThrowError(ForbiddenError);

			await expect(service.updateOne('x', {})).rejects.toThrowError(
				`'test-user' does not have permission to update collections`,
			);
		});
	});

	describe('updateBatch', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new CollectionsService({ knex: db, schema, accountability: nonAdmin });

			await expect(service.updateBatch([])).rejects.toThrowError(ForbiddenError);

			await expect(service.updateBatch([])).rejects.toThrowError(
				`'test-user' does not have permission to update collections`,
			);
		});
	});

	describe('updateMany', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new CollectionsService({ knex: db, schema, accountability: nonAdmin });

			await expect(service.updateMany(['x'], {})).rejects.toThrowError(ForbiddenError);

			await expect(service.updateMany(['x'], {})).rejects.toThrowError(
				`'test-user' does not have permission to update collections`,
			);
		});
	});

	describe('deleteOne', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new CollectionsService({ knex: db, schema, accountability: nonAdmin });

			await expect(service.deleteOne('x')).rejects.toThrowError(ForbiddenError);

			await expect(service.deleteOne('x')).rejects.toThrowError(
				`'test-user' does not have permission to delete collections`,
			);
		});

		it('should throw ForbiddenError when the collection does not exist (admin)', async () => {
			const service = new CollectionsService({
				knex: db,
				schema,
				accountability: { role: 'admin', admin: true, user: 'admin-user' } as Accountability,
			});

			vi.spyOn(CollectionsService.prototype, 'readByQuery').mockResolvedValue([]);

			await expect(service.deleteOne('missing')).rejects.toThrowError(ForbiddenError);
			await expect(service.deleteOne('missing')).rejects.toThrowError(`Collection to delete 'missing' does not exist`);
		});
	});

	describe('deleteMany', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new CollectionsService({ knex: db, schema, accountability: nonAdmin });

			await expect(service.deleteMany(['x'])).rejects.toThrowError(ForbiddenError);
			await expect(service.deleteMany(['x'])).rejects.toThrowError(`'test-user' can't delete many collections`);
		});
	});

	describe('readOne', () => {
		it('should throw ForbiddenError when the collection is not found', async () => {
			const service = new CollectionsService({ knex: db, schema, accountability: nonAdmin });

			vi.spyOn(CollectionsService.prototype, 'readMany').mockResolvedValue([]);

			await expect(service.readOne('missing')).rejects.toThrowError(ForbiddenError);
			await expect(service.readOne('missing')).rejects.toThrowError(`Collection 'missing' not found`);
		});
	});
});
