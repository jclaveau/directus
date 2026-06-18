import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
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

		describe('readOne', () => {
			it('throws a ForbiddenError with a reason when the item is not found or not accessible', async () => {
				service.readByQuery = vi.fn(async () => []);

				const error = await service.readOne(999).catch((err) => err);

				expect(error).toBeInstanceOf(ForbiddenError);

				expect(error.message).toBe('No result found for key 999 in test during items.readOne()');
			});
		});

		describe('createOne', () => {
			it('should validate user count if requested', async () => {
				await service.createOne({}, { userIntegrityCheckFlags: UserIntegrityCheckFlag.All });

				expect(validateUserCountIntegrity).toHaveBeenCalled();
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

			it('should create normally when a filter returns the payload (cancel allowed but not triggered)', async () => {
				// control: the cancel/take-over guards must only fire on null / a key, never on a payload
				const filterSpy = vi
					.spyOn(emitter, 'emitFilter')
					.mockImplementation(async (_event: any, payload: any) => payload);

				const mockReturning = vi.fn().mockResolvedValue([{ id: 1 }]);

				const mockQuery = {
					insert: vi.fn().mockReturnThis(),
					into: vi.fn().mockReturnThis(),
					returning: mockReturning,
				};

				const transactionSpy = vi
					.spyOn(db, 'transaction')
					.mockImplementation(async (callback) => callback({ ...db, ...mockQuery } as any));

				const result = await service.createOne({ name: 'Test' }, { allowFilterCancel: true });

				expect(mockQuery.insert).toHaveBeenCalled();
				expect(result).not.toBeNull();

				transactionSpy.mockRestore();
				filterSpy.mockRestore();
			});

			it('awaits async action handlers before resolving when awaitActionHooks is set', async () => {
				let actionCompleted = false;

				// Resolve on a macrotask: a fire-and-forget emitAction would let createOne
				// return before this runs, leaving actionCompleted false.
				const handler = () =>
					new Promise<void>((resolve) => {
						setTimeout(() => {
							actionCompleted = true;
							resolve();
						}, 0);
					});

				emitter.onAction('test.items.create', handler);

				try {
					await service.createOne({ name: 'Test' }, { awaitActionHooks: true });
					expect(actionCompleted).toBe(true);
				} finally {
					emitter.offAction('test.items.create', handler);
				}
			});

			it('does not await action handlers by default (fire-and-forget)', async () => {
				let actionCompleted = false;

				const handler = () =>
					new Promise<void>((resolve) => {
						setTimeout(() => {
							actionCompleted = true;
							resolve();
						}, 0);
					});

				emitter.onAction('test.items.create', handler);

				try {
					await service.createOne({ name: 'Test' });
					// Without awaitActionHooks, createOne resolves without waiting for the macrotask handler.
					expect(actionCompleted).toBe(false);
				} finally {
					emitter.offAction('test.items.create', handler);
				}
			});

			it('runs the scoped action events in parallel when awaited', async () => {
				let signalSecondStarted!: () => void;
				const secondStarted = new Promise<void>((resolve) => (signalSecondStarted = resolve));

				// The first handler only finishes once the second has started. Run sequentially
				// this deadlocks (the second never starts), so the test only passes when parallel.
				const firstHandler = () => secondStarted;

				const secondHandler = () => {
					signalSecondStarted();
				};

				emitter.onAction('items.create', firstHandler);
				emitter.onAction('test.items.create', secondHandler);

				try {
					await service.createOne({ name: 'Test' }, { awaitActionHooks: true });
				} finally {
					emitter.offAction('items.create', firstHandler);
					emitter.offAction('test.items.create', secondHandler);
				}
			});
		});

		describe('createMany', () => {
			it('should validate user count if requested', async () => {
				await service.createMany([{}], { userIntegrityCheckFlags: UserIntegrityCheckFlag.All });

				expect(validateUserCountIntegrity).toHaveBeenCalled();
			});

			it('should keep cancelled creates as null to stay index-aligned with the input', async () => {
				const filterSpy = vi.spyOn(emitter, 'emitFilter').mockResolvedValue(null);

				const result = await service.createMany([{ name: 'A' }, { name: 'B' }], { allowFilterCancel: true });

				expect(result).toEqual([null, null]);

				filterSpy.mockRestore();
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

			it('should cancel the update and return a null per key when a filter returns null and cancel is allowed', async () => {
				const filterSpy = vi.spyOn(emitter, 'emitFilter').mockResolvedValue(null);
				const transactionSpy = vi.spyOn(db, 'transaction');

				const result = await service.updateMany([1], { name: 'Test' }, { allowFilterCancel: true });

				expect(result).toEqual([null]);
				expect(transactionSpy).not.toHaveBeenCalled();

				filterSpy.mockRestore();
			});

			it('should throw when an update filter returns null but cancel is not allowed', async () => {
				const filterSpy = vi.spyOn(emitter, 'emitFilter').mockResolvedValue(null);

				await expect(service.updateMany([1], { name: 'Test' })).rejects.toThrow(InvalidPayloadError);

				filterSpy.mockRestore();
			});

			it('should run the update normally when a filter returns a non-null payload', async () => {
				const filterSpy = vi
					.spyOn(emitter, 'emitFilter')
					.mockImplementation(async (_event: any, payload: any) => payload);

				const transactionSpy = vi.spyOn(db, 'transaction');

				const result = await service.updateMany([1], { name: 'Test' }, { allowFilterCancel: true });

				expect(transactionSpy).toHaveBeenCalled();
				expect(result).toEqual([1]);

				transactionSpy.mockRestore();
				filterSpy.mockRestore();
			});
		});

		describe('deleteMany', () => {
			it('should validate user count if requested', async () => {
				await service.deleteMany([1], { userIntegrityCheckFlags: UserIntegrityCheckFlag.All });

				expect(validateUserCountIntegrity).toHaveBeenCalled();
			});

			it('should cancel the deletion and return a null per key when a filter returns null and cancel is allowed', async () => {
				const filterSpy = vi.spyOn(emitter, 'emitFilter').mockResolvedValue(null);
				const transactionSpy = vi.spyOn(db, 'transaction');

				const result = await service.deleteMany([1], { allowFilterCancel: true });

				expect(result).toEqual([null]);
				expect(transactionSpy).not.toHaveBeenCalled();

				filterSpy.mockRestore();
			});

			it('should throw when a delete filter returns null but cancel is not allowed', async () => {
				const filterSpy = vi.spyOn(emitter, 'emitFilter').mockResolvedValue(null);

				await expect(service.deleteMany([1])).rejects.toThrow(InvalidPayloadError);

				filterSpy.mockRestore();
			});

			it('should run the deletion normally when a filter returns a non-null payload', async () => {
				const filterSpy = vi
					.spyOn(emitter, 'emitFilter')
					.mockImplementation(async (_event: any, payload: any) => payload);

				const transactionSpy = vi.spyOn(db, 'transaction');

				const result = await service.deleteMany([1], { allowFilterCancel: true });

				expect(transactionSpy).toHaveBeenCalled();
				expect(result).toEqual([1]);

				transactionSpy.mockRestore();
				filterSpy.mockRestore();
			});
		});

		describe('action hook emission (await / bypass)', () => {
			const macrotaskHandler = (onDone: () => void) => () =>
				new Promise<void>((resolve) => {
					setTimeout(() => {
						onDone();
						resolve();
					}, 0);
				});

			it('still resolves when an awaited action handler throws (error caught and logged)', async () => {
				const handler = () => Promise.reject(new Error('boom'));

				emitter.onAction('test.items.create', handler);

				try {
					// emitter.emitAction swallows per-event errors, so the mutation must not reject
					const outcome = await service.createOne({ name: 'Test' }, { awaitActionHooks: true }).then(
						() => 'resolved',
						() => 'rejected',
					);

					expect(outcome).toBe('resolved');
				} finally {
					emitter.offAction('test.items.create', handler);
				}
			});

			it('routes action events to bypassEmitAction and skips the emitter', async () => {
				const emitActionSpy = vi.spyOn(emitter, 'emitAction');
				const bypassEmitAction = vi.fn().mockResolvedValue(undefined);

				await service.createOne({ name: 'Test' }, { bypassEmitAction, awaitActionHooks: true });

				expect(bypassEmitAction).toHaveBeenCalled();
				expect(emitActionSpy).not.toHaveBeenCalled();

				emitActionSpy.mockRestore();
			});

			it('awaits async action handlers on update when awaitActionHooks is set', async () => {
				let actionCompleted = false;
				const handler = macrotaskHandler(() => (actionCompleted = true));

				emitter.onAction('test.items.update', handler);

				try {
					await service.updateMany([1], { name: 'test' }, { awaitActionHooks: true });
					expect(actionCompleted).toBe(true);
				} finally {
					emitter.offAction('test.items.update', handler);
				}
			});

			it('awaits async action handlers on delete when awaitActionHooks is set', async () => {
				let actionCompleted = false;
				const handler = macrotaskHandler(() => (actionCompleted = true));

				emitter.onAction('test.items.delete', handler);

				try {
					await service.deleteMany([1], { awaitActionHooks: true });
					expect(actionCompleted).toBe(true);
				} finally {
					emitter.offAction('test.items.delete', handler);
				}
			});
		});
	});
});
