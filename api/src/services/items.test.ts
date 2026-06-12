import { VERSION_KEY_PUBLISHED, VERSION_KEY_PUBLISHED_LEGACY } from '@directus/constants';
import { SchemaBuilder } from '@directus/schema-builder';
import { UserIntegrityCheckFlag } from '@directus/types';
import knex, { type Knex } from 'knex';
import { createTracker, MockClient, Tracker } from 'knex-mock-client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockedFunction, test, vi } from 'vitest';
import { getDatabaseClient } from '../database/index.js';
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
		});

		describe('createMany', () => {
			const batchSchema = new SchemaBuilder()
				.collection('test', (c) => {
					c.field('id').id();
					c.field('name').string();
				})
				.build();

			function batchService() {
				return new ItemsService('test', { knex: db, schema: batchSchema });
			}

			it('should validate user count if requested', async () => {
				await service.createMany([{}], { userIntegrityCheckFlags: UserIntegrityCheckFlag.All });

				expect(validateUserCountIntegrity).toHaveBeenCalled();
			});

			it('uses a single batchInsert and maps the returned keys positionally when the dialect preserves RETURNING order', async () => {
				// postgres preserves insert order in RETURNING -> the batch path is taken for >1 row
				vi.mocked(getDatabaseClient).mockReturnValue('postgres');

				const batchReturning = vi.fn().mockResolvedValue([{ id: 10 }, { id: 20 }]);
				const batchInsert = vi.fn().mockReturnValue({ returning: batchReturning });

				const transactionSpy = vi
					.spyOn(db, 'transaction')
					.mockImplementation(async (callback) => callback({ ...db, batchInsert } as any));

				const result = await batchService().createMany([{ name: 'a' }, { name: 'b' }]);

				expect(batchInsert).toHaveBeenCalledTimes(1);
				expect(batchInsert.mock.calls[0]![1]).toEqual([{ name: 'a' }, { name: 'b' }]);
				expect(result).toEqual([10, 20]);

				transactionSpy.mockRestore();
			});

			it('falls back to a per-row insert loop when the dialect does not preserve RETURNING order', async () => {
				// mysql has no order-preserving RETURNING -> each row is inserted individually
				vi.mocked(getDatabaseClient).mockReturnValue('mysql');

				const returning = vi
					.fn()
					.mockResolvedValueOnce([{ id: 1 }])
					.mockResolvedValueOnce([{ id: 2 }]);

				const into = vi.fn().mockReturnValue({ returning });
				const insert = vi.fn().mockReturnValue({ into });

				const transactionSpy = vi
					.spyOn(db, 'transaction')
					.mockImplementation(async (callback) => callback({ ...db, insert } as any));

				const result = await batchService().createMany([{ name: 'a' }, { name: 'b' }]);

				expect(insert).toHaveBeenCalledTimes(2);
				expect(result).toEqual([1, 2]);

				transactionSpy.mockRestore();
			});

			it('returns an empty array without opening a transaction for an empty input', async () => {
				const transactionSpy = vi.spyOn(db, 'transaction');

				const result = await batchService().createMany([]);

				expect(result).toEqual([]);
				expect(transactionSpy).not.toHaveBeenCalled();

				transactionSpy.mockRestore();
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
		});

		describe('deleteMany', () => {
			it('should validate user count if requested', async () => {
				await service.deleteMany([1], { userIntegrityCheckFlags: UserIntegrityCheckFlag.All });

				expect(validateUserCountIntegrity).toHaveBeenCalled();
			});
		});
	});
});
