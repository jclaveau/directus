import { SchemaBuilder } from '@directus/schema-builder';
import { UserIntegrityCheckFlag } from '@directus/types';
import knex, { type Knex } from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import emitter from '../emitter.js';
import { validateUserCountIntegrity } from '../utils/validate-user-count-integrity.js';
import { ItemsService } from './index.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('../utils/validate-user-count-integrity.js');

const schema = new SchemaBuilder()
	.collection('test', (c) => {
		c.field('id').id();
		c.field('name').string();
		c.field('children').o2m('children', 'parent_id');
	})
	.collection('children', (c) => {
		c.field('id').id();
		c.field('parent_id').m2o('test');
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
		tracker.on.any('children').response([]);
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

		describe('createOne', () => {
			it('should validate user count if requested', async () => {
				await service.createOne({}, { userIntegrityCheckFlags: UserIntegrityCheckFlag.All });

				expect(validateUserCountIntegrity).toHaveBeenCalled();
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
			it('should run the update and validate user count for a non-empty payload', async () => {
				await service.updateMany([1], { name: 'test' }, { userIntegrityCheckFlags: UserIntegrityCheckFlag.All });

				expect(validateUserCountIntegrity).toHaveBeenCalled();
				// a real write opens a transaction and issues the update query
				expect(tracker.history.all.length).toBeGreaterThan(0);
			});

			it('should skip the update and not validate user count when the payload is empty', async () => {
				const keys = await service.updateMany([1], {}, { userIntegrityCheckFlags: UserIntegrityCheckFlag.All });

				expect(keys).toEqual([]);
				expect(validateUserCountIntegrity).not.toHaveBeenCalled();
				expect(tracker.history.all).toHaveLength(0);
			});

			it('should skip the update when the payload only contains the primary key', async () => {
				const keys = await service.updateMany([1], { id: 1 }, { userIntegrityCheckFlags: UserIntegrityCheckFlag.All });

				expect(keys).toEqual([]);
				expect(validateUserCountIntegrity).not.toHaveBeenCalled();
				expect(tracker.history.all).toHaveLength(0);
			});

			it('should skip the update when a nested relation is reduced to an empty alterations object', async () => {
				const keys = await service.updateMany(
					[1],
					{ children: { create: [], update: [], delete: [] } },
					{ userIntegrityCheckFlags: UserIntegrityCheckFlag.All },
				);

				expect(keys).toEqual([]);
				expect(validateUserCountIntegrity).not.toHaveBeenCalled();
				// no query for the parent row nor the nested relation
				expect(tracker.history.all).toHaveLength(0);
			});

			it('should skip the update for a partial alterations object with only empty operations', async () => {
				for (const alterations of [{ create: [] }, { update: [] }, { delete: [] }, {}]) {
					const keys = await service.updateMany([1], { children: alterations });

					expect(keys).toEqual([]);
				}

				expect(validateUserCountIntegrity).not.toHaveBeenCalled();
				expect(tracker.history.all).toHaveLength(0);
			});

			it('should NOT skip a bare empty relational array (it removes all existing children)', async () => {
				await service.updateMany([1], { children: [] });

				// the relation is processed (children are detached/removed), so queries are issued
				expect(tracker.history.all.length).toBeGreaterThan(0);
			});

			it('should NOT skip an alterations object that carries an operation', async () => {
				await service.updateMany([1], { children: { create: [], update: [], delete: [5] } });

				expect(tracker.history.all.length).toBeGreaterThan(0);
			});

			it('should NOT skip an object on a relational alias that is not alterations-shaped', async () => {
				await expect(service.updateMany([1], { children: { foo: 1 } })).rejects.toThrow();
			});

			it('should not emit an action hook when the update is skipped as a no-op', async () => {
				const emitActionSpy = vi.spyOn(emitter, 'emitAction');

				const keys = await service.updateMany([1], {});

				expect(keys).toEqual([]);
				expect(emitActionSpy).not.toHaveBeenCalled();

				emitActionSpy.mockRestore();
			});

			it('should emit an action hook for a real write (control for the skip case)', async () => {
				const emitActionSpy = vi.spyOn(emitter, 'emitAction');

				await service.updateMany([1], { name: 'test' });

				expect(emitActionSpy).toHaveBeenCalled();

				emitActionSpy.mockRestore();
			});

			it('should skip when a filter hook strips the only changed field down to the primary key', async () => {
				// the decision is made on the post-hook payload, so a hook can turn a write into a no-op
				const emitFilterSpy = vi.spyOn(emitter, 'emitFilter').mockResolvedValue({ id: 1 });

				const keys = await service.updateMany([1], { name: 'changed' });

				expect(keys).toEqual([]);
				expect(tracker.history.all).toHaveLength(0);

				emitFilterSpy.mockRestore();
			});

			it('should write when a filter hook adds a real field to a would-be no-op payload', async () => {
				// the inverse: a PK-only payload that a hook enriches must no longer be skipped
				const emitFilterSpy = vi.spyOn(emitter, 'emitFilter').mockResolvedValue({ id: 1, name: 'added' });

				await service.updateMany([1], { id: 1 });

				expect(tracker.history.all.length).toBeGreaterThan(0);

				emitFilterSpy.mockRestore();
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
