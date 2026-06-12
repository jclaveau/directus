import { VERSION_KEY_PUBLISHED, VERSION_KEY_PUBLISHED_LEGACY } from '@directus/constants';
import { InvalidPayloadError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import { UserIntegrityCheckFlag } from '@directus/types';
import knex, { type Knex } from 'knex';
import { createTracker, MockClient, Tracker } from 'knex-mock-client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockedFunction, test, vi } from 'vitest';
import { getDatabaseClient } from '../database/index.js';
import emitter from '../emitter.js';
import { validateUserCountIntegrity } from '../utils/validate-user-count-integrity.js';
import { handleVersion } from '../utils/versioning/handle-version.js';
import { ItemsService } from './index.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('../utils/validate-user-count-integrity.js');
vi.mock('../utils/versioning/handle-version.js', { spy: true });

const schema = new SchemaBuilder()
	.collection('test', (c) => {
		c.field('id').id();
	})
	.collection('directus_versions', (c) => {
		c.field('id').id();
		c.field('item').string();
		c.field('collection').string();
		c.field('key').string();
	})
	.build();

describe('Integration Tests', () => {
	let db: MockedFunction<Knex>;
	let tracker: Tracker;

	beforeAll(async () => {
		db = vi.mocked(knex.default({ client: MockClient }));
		tracker = createTracker(db);
	});

	beforeEach(() => {
		tracker.on.any('test').response({});
	});

	afterEach(() => {
		tracker.reset();
	});

	describe('Services / Items', () => {
		let service: ItemsService;

		beforeEach(() => {
			service = new ItemsService('test', {
				knex: db,
				schema,
			});
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		describe('read with version "test"', () => {
			test('on readOne', async () => {
				vi.mocked(handleVersion).mockReturnValueOnce(new Promise((resolve) => resolve([{ id: 1 }])));

				await service.readOne(1, { version: 'test' });

				expect(handleVersion).toHaveBeenCalled();
			});

			test('on readSingleton', async () => {
				vi.mocked(handleVersion).mockReturnValueOnce(new Promise((resolve) => resolve([{ id: 1 }])));

				vi.spyOn(db, 'select').mockReturnValueOnce({
					from: () => ({
						first: async () => ({ id: 1 }),
					}),
				} as any);

				await service.readSingleton({ version: 'test' });

				expect(handleVersion).toHaveBeenCalled();
			});
		});

		describe('read with published version key', () => {
			test('on readOne with current key', async () => {
				service.readByQuery = vi.fn(async () => [{ id: 1 }]);

				await service.readOne(1, { version: VERSION_KEY_PUBLISHED });

				expect(handleVersion).not.toHaveBeenCalled();
			});

			test('on readSingleton with current key', async () => {
				service.readByQuery = vi.fn(async () => [{ id: 1 }]);

				await service.readSingleton({ version: VERSION_KEY_PUBLISHED });

				expect(handleVersion).not.toHaveBeenCalled();
			});

			test('on readOne with legacy key (backwards compat)', async () => {
				service.readByQuery = vi.fn(async () => [{ id: 1 }]);

				await service.readOne(1, { version: VERSION_KEY_PUBLISHED_LEGACY });

				expect(handleVersion).not.toHaveBeenCalled();
			});

			test('on readSingleton with legacy key (backwards compat)', async () => {
				service.readByQuery = vi.fn(async () => [{ id: 1 }]);

				await service.readSingleton({ version: VERSION_KEY_PUBLISHED_LEGACY });

				expect(handleVersion).not.toHaveBeenCalled();
			});
		});

		describe('createOne', () => {
			it('should validate user count if requested', async () => {
				await service.createOne({}, { userIntegrityCheckFlags: UserIntegrityCheckFlag.All });

				expect(validateUserCountIntegrity).toHaveBeenCalled();
			});

			it('should use includeTriggerModifications for MS SQL', async () => {
				vi.mocked(getDatabaseClient).mockReturnValue('mssql');

				const mockReturning = vi.fn().mockResolvedValue([{ id: 1 }]);

				const mockQuery = {
					insert: vi.fn().mockReturnThis(),
					into: vi.fn().mockReturnThis(),
					returning: mockReturning,
				};

				const transactionSpy = vi.spyOn(db, 'transaction').mockImplementation(async (callback) => {
					const trx = { ...db, ...mockQuery };
					return await callback(trx as any);
				});

				await service.createOne({ name: 'Test' });

				expect(mockReturning).toHaveBeenCalledWith('id', { includeTriggerModifications: true });

				transactionSpy.mockRestore();
			});

			it('should not use includeTriggerModifications for non-MS SQL', async () => {
				vi.mocked(getDatabaseClient).mockReturnValue('postgres');

				const mockReturning = vi.fn().mockResolvedValue([{ id: 1 }]);

				const mockQuery = {
					insert: vi.fn().mockReturnThis(),
					into: vi.fn().mockReturnThis(),
					returning: mockReturning,
				};

				const transactionSpy = vi.spyOn(db, 'transaction').mockImplementation(async (callback) => {
					const trx = { ...db, ...mockQuery };
					return await callback(trx as any);
				});

				await service.createOne({ name: 'Test' });

				expect(mockReturning).toHaveBeenCalledWith('id', undefined);

				transactionSpy.mockRestore();
			});

			it('should short-circuit and return the key when a create filter returns a primary key', async () => {
				vi.spyOn(emitter, 'emitFilter').mockResolvedValue(5);

				const insert = vi.fn().mockReturnThis();

				const transactionSpy = vi.spyOn(db, 'transaction').mockImplementation(async (callback) => {
					return await callback({ ...db, insert } as any);
				});

				const result = await service.createOne({ name: 'Test' });

				expect(result).toBe(5);
				expect(insert).not.toHaveBeenCalled();

				transactionSpy.mockRestore();
			});

			it('should cancel the create and return null when a filter returns null and cancel is allowed', async () => {
				const filterSpy = vi.spyOn(emitter, 'emitFilter').mockResolvedValue(null);

				const insert = vi.fn().mockReturnThis();

				const transactionSpy = vi.spyOn(db, 'transaction').mockImplementation(async (callback) => {
					return await callback({ ...db, insert } as any);
				});

				const result = await service.createOne({ name: 'Test' }, { allowFilterCancel: true });

				expect(result).toBeNull();
				expect(insert).not.toHaveBeenCalled();

				transactionSpy.mockRestore();
				filterSpy.mockRestore();
			});

			it('should throw when a filter returns null but cancel is not allowed', async () => {
				const filterSpy = vi.spyOn(emitter, 'emitFilter').mockResolvedValue(null);

				const transactionSpy = vi.spyOn(db, 'transaction').mockImplementation(async (callback) => {
					return await callback({ ...db } as any);
				});

				await expect(service.createOne({ name: 'Test' })).rejects.toThrow(InvalidPayloadError);

				transactionSpy.mockRestore();
				filterSpy.mockRestore();
			});
		});

		describe('createMany', () => {
			it('should validate user count if requested', async () => {
				await service.createMany([{}], { userIntegrityCheckFlags: UserIntegrityCheckFlag.All });

				expect(validateUserCountIntegrity).toHaveBeenCalled();
			});
		});

		describe('updateBatch', () => {
			it('should validate user count if requested', async () => {
				await service.updateBatch([{ id: 1 }], { userIntegrityCheckFlags: UserIntegrityCheckFlag.All });

				expect(validateUserCountIntegrity).toHaveBeenCalled();
			});
		});

		describe('updateMany', () => {
			it('should validate user count if requested', async () => {
				await service.updateMany([1], {}, { userIntegrityCheckFlags: UserIntegrityCheckFlag.All });

				expect(validateUserCountIntegrity).toHaveBeenCalled();
			});

			it('should cancel the update and return [] when a filter returns null and cancel is allowed', async () => {
				const filterSpy = vi.spyOn(emitter, 'emitFilter').mockResolvedValue(null);
				const transactionSpy = vi.spyOn(db, 'transaction');

				const result = await service.updateMany([1], { name: 'Test' }, { allowFilterCancel: true });

				expect(result).toEqual([]);
				expect(transactionSpy).not.toHaveBeenCalled();

				filterSpy.mockRestore();
			});

			it('should throw when a filter returns null but cancel is not allowed', async () => {
				const filterSpy = vi.spyOn(emitter, 'emitFilter').mockResolvedValue(null);

				await expect(service.updateMany([1], { name: 'Test' })).rejects.toThrow(InvalidPayloadError);

				filterSpy.mockRestore();
			});
		});

		describe('deleteMany', () => {
			it('should validate user count if requested', async () => {
				await service.deleteMany([1], { userIntegrityCheckFlags: UserIntegrityCheckFlag.All });

				expect(validateUserCountIntegrity).toHaveBeenCalled();
			});

			it('should cancel the deletion and return [] when a filter returns null and cancel is allowed', async () => {
				const filterSpy = vi.spyOn(emitter, 'emitFilter').mockResolvedValue(null);
				const transactionSpy = vi.spyOn(db, 'transaction');

				const result = await service.deleteMany([1], { allowFilterCancel: true });

				expect(result).toEqual([]);
				expect(transactionSpy).not.toHaveBeenCalled();

				filterSpy.mockRestore();
			});

			it('should throw when a filter returns null but cancel is not allowed', async () => {
				const filterSpy = vi.spyOn(emitter, 'emitFilter').mockResolvedValue(null);

				await expect(service.deleteMany([1])).rejects.toThrow(InvalidPayloadError);

				filterSpy.mockRestore();
			});
		});
	});
});
