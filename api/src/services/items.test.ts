import {
	ForbiddenError,
	InvalidForeignKeyError,
	InvalidPayloadError,
} from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import { UserIntegrityCheckFlag } from '@directus/types';
import { oneLine } from '@directus/utils';
import knex, { type Knex } from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { getDatabaseClient } from '../database/index.js';
import emitter from '../emitter.js';
import { readMeta } from '../utils/read-meta.js';
import { transaction } from '../utils/transaction.js';
import { validateUserCountIntegrity } from '../utils/validate-user-count-integrity.js';
import { ItemsService } from './items.js';

// Mirrors scoped-cache-purge.test.ts: force auto-purge on so shouldClearCache() routes to a
// truthy cache, mock the database client to postgres, and stub the scoped-cache module so the
// real redis/bus never loads. These stubs let the system/uuid/singleton describes exercise pre-existing
// ItemsService branches (system-collection event names, uuid PKs, revisions, deleteByQuery,
// singletons) without a full system schema, and are inert for the Integration Tests.
// Hoisted so the hoisted `@directus/env` factory (and any eagerly-loaded module that calls
// useEnv() at import time) sees an initialized env.
const env = vi.hoisted<Record<string, any>>(() => {
	return {
		CACHE_AUTO_PURGE: true,
		CACHE_AUTO_PURGE_IGNORE_LIST: [],
		CACHE_NAMESPACE: 'scalabus',
		MAX_BATCH_MUTATION: 100000,
		// The Integration Tests' nested-relation path dynamically loads notifications -> mail, which
		// resolves this at import time.
		EMAIL_TEMPLATES_PATH: './templates',
	};
});

vi.mock('@directus/env', () => ({ useEnv: () => env }));

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseForAccountability: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('../utils/validate-user-count-integrity.js');

vi.mock('../cache.js', () => {
	return {
		getCache: () => {
			return { cache: { clear: vi.fn(), delete: vi.fn() } };
		},
	};
});

vi.mock('../scoped-cache.js', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('../scoped-cache.js')>()),
		purgeScopedCache: vi.fn(),
		scopedCachePurgeEnabled: () => {
			return true;
		},
	};
});

// Every batch of rows handed to the revision writer, so a test can assert
// which snapshot was filed under which item.
const revisionWrites = vi.hoisted<any[][]>(() => []);

// The revision path dynamically imports these; stub them so the activity/revision write loop
// (incl. the `snapshots && Array.isArray(snapshots)` ternary) runs without a full system schema.
vi.mock('./activity.js', () => {
	return {
		ActivityService: class {
			createMany = vi.fn(async (rows: any[]) => {
				return rows.map((_, i) => i + 1);
			});
		},
	};
});

vi.mock('./revisions.js', () => {
	return {
		RevisionsService: class {
			createMany = vi.fn(async (rows: any[]) => {
				revisionWrites.push(rows);
				return rows.map((_, i) => i + 1);
			});

			updateMany = vi.fn(async () => {
				return [];
			});
		},
	};
});

// Accountability paths call into the permissions layer; stub it so create/update with an
// accountability run their `processPayload` / `validateAccess` branches without real grants.
vi.mock('../permissions/modules/process-payload/process-payload.js', () => {
	return {
		processPayload: vi.fn(async ({ payload }: { payload: any }) => {
			return payload;
		}),
	};
});

vi.mock('../permissions/modules/validate-access/validate-access.js', () => {
	return {
		validateAccess: vi.fn(async () => {}),
	};
});

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

		// PayloadService reaches for `get-service.js` lazily — a static import would be
		// a cycle — and that module pulls in every service. Whichever test first walks a
		// relational path pays the load-and-transform of that graph inside its own 5s
		// budget, which is what timed the o2m case out under CI load. Pay it here
		// instead, with a budget sized for module loading rather than for a test: 3.3s
		// on an idle box, over 10s when the run is contended.
		await import('../utils/get-service.js');
	}, 120_000);

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

			it('awaits action handlers by default', async () => {
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
					// This fork awaits action hooks by default.
					expect(actionCompleted).toBe(true);
				} finally {
					emitter.offAction('test.items.create', handler);
				}
			});

			it('skips awaiting when awaitActionHooks is false', async () => {
				let actionCompleted = false;

				const handler = () => {
					return new Promise<void>((resolve) => {
						setTimeout(() => {
							actionCompleted = true;
							resolve();
						}, 0);
					});
				};

				emitter.onAction('test.items.create', handler);

				try {
					await service.createOne({ name: 'Test' }, { awaitActionHooks: false });
					expect(actionCompleted).toBe(false);
				}
				finally {
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
			// A schema without relations so batchInsert is the only query path under test.
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

			it('should keep cancelled creates as null to stay index-aligned with the input', async () => {
				const filterSpy = vi.spyOn(emitter, 'emitFilter').mockResolvedValue(null);

				const result = await service.createMany([{ name: 'A' }, { name: 'B' }], { allowFilterCancel: true });

				expect(result).toEqual([null, null]);

				filterSpy.mockRestore();
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

			it('throws when batchInsert returns fewer rows than prepared (positional mapping would be wrong)', async () => {
				vi.mocked(getDatabaseClient).mockReturnValue('postgres');

				// two rows in, only one key back -> the positional row->key mapping is unsafe
				const batchReturning = vi.fn().mockResolvedValue([{ id: 10 }]);
				const batchInsert = vi.fn().mockReturnValue({ returning: batchReturning });

				const transactionSpy = vi
					.spyOn(db, 'transaction')
					.mockImplementation(async (callback) => callback({ ...db, batchInsert } as any));

				await expect(batchService().createMany([{ name: 'a' }, { name: 'b' }])).rejects.toThrow(/expected 2/);

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

			it('emits the delete filter exactly once (no double-fire)', async () => {
				const filterSpy = vi
					.spyOn(emitter, 'emitFilter')
					.mockImplementation(async (_event: any, payload: any) => payload);

				await service.deleteMany([1]);

				const deleteFilterCalls = filterSpy.mock.calls.filter(([event]) => {
					return [event].flat().includes('items.delete');
				});

				expect(deleteFilterCalls).toHaveLength(1);

				filterSpy.mockRestore();
			});

			it('translates a raw DB error from a direct delete write', async () => {
				const fkError: any = new Error(oneLine`
					update or delete on table "parent" violates foreign key
					constraint "child_parent_foreign" on table "child"
				`);

				fkError.code = '23503';
				fkError.table = 'child';
				fkError.detail = 'Key (id)=(1) is still referenced from table "child".';

				tracker.on.delete('test').simulateError(fkError);

				await expect(service.deleteMany([1])).rejects.toThrow(
					InvalidForeignKeyError,
				);
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

	describe('mutation tracker retry safety (#312)', () => {
		// #312: transaction() retries the handler on SQLITE_BUSY / cockroach 40001. The
		// mutation tracker lives outside the retried handler, so without a reset a retry
		// re-counts the nested M2O mutations onto the outer count -> over-count.
		// The fake knex below only needs isTransaction + a transaction() that runs the
		// handler; transaction() passes knex to the mocked getDatabaseClient only.
		const retryingKnex = {
			isTransaction: false,
			transaction: (handler: (trx: Knex) => Promise<unknown>) => {
				return handler({ isTransaction: true } as unknown as Knex);
			},
		} as unknown as Knex;

		function busyOnFirstAttempt(
			mutationTracker: ReturnType<ItemsService['createMutationTracker']>,
		) {
			let attempts = 0;

			return async function handler() {
				// The nested M2O count added inside the retried handler.
				mutationTracker.trackMutations(2);

				if (attempts++ === 0) {
					throw Object.assign(new Error('database is locked'), {
						code: 'SQLITE_BUSY',
					});
				}
			};
		}

		it('restores outer count on retry, nested not double-counted', async () => {
			vi.mocked(getDatabaseClient).mockReturnValueOnce('sqlite');
			const service = new ItemsService('test', { knex: db, schema });
			const mutationTracker = service.createMutationTracker();

			// The outer count (e.g. data.length), added once outside the transaction.
			mutationTracker.trackMutations(3);

			await transaction(
				retryingKnex,
				busyOnFirstAttempt(mutationTracker),
				mutationTracker.snapshot(),
			);

			// 3 outer + 2 nested, NOT 3 + 2 + 2 (the nested count re-added on retry).
			expect(mutationTracker.getCount()).toBe(5);
		});

		it('over-counts without the snapshot restore (control witness)', async () => {
			vi.mocked(getDatabaseClient).mockReturnValueOnce('sqlite');
			const service = new ItemsService('test', { knex: db, schema });
			const mutationTracker = service.createMutationTracker();

			mutationTracker.trackMutations(3);

			// No onRetry restore passed, so the bug reproduces.
			await transaction(retryingKnex, busyOnFirstAttempt(mutationTracker));

			expect(mutationTracker.getCount()).toBe(7);
		});

		it('does not wrongly exceed MAX_BATCH_MUTATION after a retry', async () => {
			const savedMax = env['MAX_BATCH_MUTATION'];
			// 3 outer + 2 nested = 5 <= 6, but the double-counted 7 would exceed it.
			env['MAX_BATCH_MUTATION'] = 6;

			try {
				vi.mocked(getDatabaseClient).mockReturnValueOnce('sqlite');
				const service = new ItemsService('test', { knex: db, schema });
				const mutationTracker = service.createMutationTracker();

				mutationTracker.trackMutations(3);

				await expect(
					transaction(
						retryingKnex,
						busyOnFirstAttempt(mutationTracker),
						mutationTracker.snapshot(),
					),
				).resolves.toBeUndefined();
			}
			finally {
				env['MAX_BATCH_MUTATION'] = savedMax;
			}
		});

		it('wrongly rejects at the limit without restore (control)', async () => {
			const savedMax = env['MAX_BATCH_MUTATION'];
			env['MAX_BATCH_MUTATION'] = 6;

			try {
				vi.mocked(getDatabaseClient).mockReturnValueOnce('sqlite');
				const service = new ItemsService('test', { knex: db, schema });
				const mutationTracker = service.createMutationTracker();

				mutationTracker.trackMutations(3);

				await expect(
					transaction(retryingKnex, busyOnFirstAttempt(mutationTracker)),
				).rejects.toThrow('Exceeded max batch mutation limit');
			}
			finally {
				env['MAX_BATCH_MUTATION'] = savedMax;
			}
		});
	});
});

describe('ItemsService — system collections, uuid PKs, revisions, singletons', () => {
	const shapesSchema = new SchemaBuilder()
		.collection('test', (c) => {
			c.field('id').id();
			c.field('name').string();
		})
		.collection('uuid_coll', (c) => {
			c.field('id').uuid()
				.primary();

			c.field('name').string();
		})
		// A system collection: eventScope becomes `users`, so the `${eventScope}.create/update/
		// delete/read/query` event-name branches run instead of the `items.*` ones.
		.collection('directus_users', (c) => {
			c.field('id').id();
			c.field('name').string();
		})
		// A singleton collection with a defaulted field so readSingleton can synthesize defaults.
		.collection('settings', (c) => {
			c.field('id').id();
			c.field('theme').string();
		})
		.build();

	shapesSchema.collections['settings']!.singleton = true;
	shapesSchema.collections['settings']!.fields['theme']!.defaultValue = 'auto';

	let db: MockedFunction<Knex>;
	let tracker: Tracker;

	beforeAll(() => {
		db = vi.mocked(knex.default({ client: MockClient }));
		tracker = createTracker(db);
	});

	afterEach(() => {
		tracker.reset();
		revisionWrites.length = 0;
		vi.clearAllMocks();
	});

	describe('system collection event scope', () => {
		const service = () => {
			return new ItemsService('directus_users', { knex: db, schema: shapesSchema });
		};

		it('createOne on a system collection emits `<scope>.create` events', async () => {
			tracker.on.insert('directus_users').response([1]);

			const key = await service().createOne({ name: 'admin' });

			expect(key).toBe(1);
		});

		it(oneLine`
			readByQuery on a system collection emits \`<scope>.query/read\` events
		`, async () => {
			tracker.on.select('directus_users').response([{ id: 1, name: 'admin' }]);

			const result = await service().readByQuery({});

			expect(result).toEqual([{ id: 1, name: 'admin' }]);
		});

		it('updateMany on a system collection emits `<scope>.update` events', async () => {
			tracker.on.select('directus_users').response([{ id: 1, name: 'admin' }]);
			tracker.on.update('directus_users').response(1);

			const keys = await service().updateMany([1], { name: 'renamed' });

			expect(keys).toEqual([1]);
		});

		it('deleteMany on a system collection emits `<scope>.delete` events', async () => {
			tracker.on.delete('directus_users').response(1);

			const keys = await service().deleteMany([1]);

			expect(keys).toEqual([1]);
		});
	});

	describe('uuid primary key', () => {
		const service = () => {
			return new ItemsService('uuid_coll', { knex: db, schema: shapesSchema });
		};

		const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

		it('createOne formats the returned uuid primary key', async () => {
			// The PayloadService generates the uuid PK from the field's special, so the stored key
			// is a valid uuid run through formatUUID (no-op on postgres) rather than the raw input.
			tracker.on.insert('uuid_coll')
				.response([{ id: '11111111-1111-1111-1111-111111111111' }]);

			const key = await service().createOne({ name: 'x' });

			expect(key).toMatch(uuidPattern);
		});

		it(oneLine`
			createMany formats uuid PKs through the batchInsert path (postgres returns in order)
		`, async () => {
			// >1 row + postgres preservesInsertOrderInReturning() → the batchInsert branch, where
			// each returned uuid is run through formatUUID.
			tracker.on.insert('uuid_coll').response([
				{ id: '11111111-1111-1111-1111-111111111111' },
				{ id: '22222222-2222-2222-2222-222222222222' },
			]);

			const keys = await service().createMany([{ name: 'a' }, { name: 'b' }]);

			expect(keys).toHaveLength(2);
			expect(keys[0]).toMatch(uuidPattern);
			expect(keys[1]).toMatch(uuidPattern);
		});

		it('createMany batchInsert reads a bare scalar returning value', async () => {
			// A driver that returns bare PKs (not `{ id }` objects) exercises the `: row` arm.
			const service = new ItemsService('test', { knex: db, schema: shapesSchema });
			tracker.on.insert('test').response([1, 2]);

			const keys = await service.createMany([{ name: 'a' }, { name: 'b' }]);

			expect(keys).toEqual([1, 2]);
		});
	});

	describe('updateByQuery / deleteByQuery key resolution', () => {
		const service = () => new ItemsService('test', { knex: db, schema: shapesSchema });

		it('deleteByQuery deletes the keys the query resolves', async () => {
			tracker.on.select('test').response([{ id: 1 }, { id: 2 }]);
			tracker.on.delete('test').response(2);

			const keys = await service().deleteByQuery({ filter: { name: { _eq: 'x' } } });

			expect(keys).toEqual([1, 2]);
		});

		it('deleteByQuery returns [] when the query matches nothing', async () => {
			tracker.on.select('test').response([]);

			const keys = await service().deleteByQuery({ filter: { name: { _eq: 'nope' } } });

			expect(keys).toEqual([]);
		});

		it('updateByQuery returns [] when the query matches nothing', async () => {
			tracker.on.select('test').response([]);

			const keys = await service().updateByQuery(
				{ filter: { name: { _eq: 'nope' } } },
				{ name: 'y' },
			);

			expect(keys).toEqual([]);
		});

		it('updateByQuery updates the keys the query resolves', async () => {
			tracker.on.select('test').response([{ id: 1 }]);
			tracker.on.update('test').response(1);

			const keys = await service().updateByQuery(
				{ filter: { name: { _eq: 'x' } } },
				{ name: 'y' },
			);

			expect(keys).toEqual([1]);
		});
	});

	describe('updateMany writes revisions when accountability tracks all', () => {
		it('snapshots the read rows into revision data', async () => {
			const accountabilitySchema = new SchemaBuilder()
				.collection('tracked', (c) => {
					c.field('id').id();
					c.field('name').string();
				})
				.build();

			accountabilitySchema.collections['tracked']!.accountability = 'all';

			const service = new ItemsService('tracked', {
				knex: db,
				schema: accountabilitySchema,
				accountability: { user: 'u1', role: 'r1', admin: true, app: true } as any,
			});

			tracker.on.update('tracked').response(1);
			// readMany re-reads the post-update rows; these become the revision `snapshots`.
			tracker.on.select('tracked').response([{ id: 1, name: 'after' }]);

			const keys = await service.updateMany([1], { name: 'after' });

			expect(keys).toEqual([1]);

			expect(revisionWrites[0]).toMatchObject([
				{ item: 1, data: '{"id":1,"name":"after"}' },
			]);
		});

		it('files each snapshot under its own item, not by read order', async () => {
			const accountabilitySchema = new SchemaBuilder()
				.collection('tracked', (c) => {
					c.field('id').id();
					c.field('name').string();
				})
				.build();

			accountabilitySchema.collections['tracked']!.accountability = 'all';

			const service = new ItemsService('tracked', {
				knex: db,
				schema: accountabilitySchema,
				accountability: { user: 'u1', role: 'r1', admin: true, app: true } as any,
			});

			tracker.on.update('tracked').response(2);

			// `readMany` applies no ordering, so the rows may come back in any order —
			// here reversed, which is what positional pairing got wrong.
			tracker.on.select('tracked').response([
				{ id: 2, name: 'second' },
				{ id: 1, name: 'first' },
			]);

			revisionWrites.length = 0;

			await service.updateMany([1, 2], { name: 'after' });

			const rows = revisionWrites[0];

			expect(rows).toHaveLength(2);

			expect(rows!.map((row) => [row.item, JSON.parse(row.data)])).toEqual([
				[1, { id: 1, name: 'first' }],
				[2, { id: 2, name: 'second' }],
			]);
		});

		it('pairs snapshots when the caller passes the keys as strings', async () => {
			const accountabilitySchema = new SchemaBuilder()
				.collection('tracked', (c) => {
					c.field('id').id();
					c.field('name').string();
				})
				.build();

			accountabilitySchema.collections['tracked']!.accountability = 'all';

			const service = new ItemsService('tracked', {
				knex: db,
				schema: accountabilitySchema,
				accountability: { user: 'u1', role: 'r1', admin: true, app: true } as any,
			});

			tracker.on.update('tracked').response(2);

			tracker.on.select('tracked').response([
				{ id: 2, name: 'second' },
				{ id: 1, name: 'first' },
			]);

			// A REST caller hands the keys through as strings while the driver
			// answers with numbers, so both sides of the lookup need coercing.
			await service.updateMany(['1', '2'], { name: 'after' });

			const rows = revisionWrites[0];

			expect(rows).toHaveLength(2);

			expect(rows!.map((row) => [row.item, JSON.parse(row.data)])).toEqual([
				['1', { id: 1, name: 'first' }],
				['2', { id: 2, name: 'second' }],
			]);
		});

		it('pairs snapshots when the keys cross a digit boundary', async () => {
			const accountabilitySchema = new SchemaBuilder()
				.collection('tracked', (c) => {
					c.field('id').id();
					c.field('name').string();
				})
				.build();

			accountabilitySchema.collections['tracked']!.accountability = 'all';

			const service = new ItemsService('tracked', {
				knex: db,
				schema: accountabilitySchema,
				accountability: { user: 'u1', role: 'r1', admin: true, app: true } as any,
			});

			tracker.on.update('tracked').response(3);

			// The read answers in numeric order, which is also insertion order here.
			tracker.on.select('tracked').response([
				{ id: 8, name: 'eight' },
				{ id: 9, name: 'nine' },
				{ id: 10, name: 'ten' },
			]);

			revisionWrites.length = 0;

			// `updateMany` sorts the keys with no comparator, so 8, 9, 10 becomes
			// 10, 8, 9 — the read order and the key order disagree on every row
			// whenever an integer key set crosses a digit boundary.
			await service.updateMany([8, 9, 10], { name: 'after' });

			const rows = revisionWrites[0];

			expect(rows).toHaveLength(3);

			expect(rows!.map((row) => [row.item, JSON.parse(row.data).name])).toEqual([
				[10, 'ten'],
				[8, 'eight'],
				[9, 'nine'],
			]);
		});
	});

	describe('singletons', () => {
		it('readSingleton synthesizes defaults for an empty collection', async () => {
			tracker.on.select('settings').response([]);

			const service = new ItemsService('settings', { knex: db, schema: shapesSchema });
			const record = await service.readSingleton({ fields: ['*'] });

			expect(record).toEqual({ id: null, theme: 'auto' });
			expect(readMeta(record)?.scopedCacheTags).toBeDefined();
		});

		it('readSingleton returns the existing record when present', async () => {
			tracker.on.select('settings').response([{ id: 1, theme: 'dark' }]);

			const service = new ItemsService('settings', { knex: db, schema: shapesSchema });
			const record = await service.readSingleton({ fields: ['*'] });

			expect(record).toEqual({ id: 1, theme: 'dark' });
		});

		it('upsertSingleton updates the existing singleton row', async () => {
			// The pre-read finds a row → updateOne path.
			tracker.on.select('settings').responseOnce([{ id: 1 }]);
			tracker.on.select('settings').response([{ id: 1, theme: 'dark' }]);
			tracker.on.update('settings').response(1);

			const service = new ItemsService('settings', { knex: db, schema: shapesSchema });
			const key = await service.upsertSingleton({ theme: 'dark' });

			expect(key).toBe(1);
		});

		it('upsertSingleton creates a row when the singleton is empty', async () => {
			// The pre-read finds nothing → createOne path.
			tracker.on.select('settings').response([]);
			tracker.on.insert('settings').response([1]);

			const service = new ItemsService('settings', { knex: db, schema: shapesSchema });
			const key = await service.upsertSingleton({ theme: 'dark' });

			expect(key).toBe(1);
		});
	});

	describe('accountability create/update run the permissions branches', () => {
		const accountability = { user: 'u1', role: 'r1', admin: false, app: true } as any;

		it('createOne with accountability runs processPayload', async () => {
			tracker.on.insert('test').response([1]);

			const service = new ItemsService('test', {
				knex: db,
				schema: shapesSchema,
				accountability,
			});

			const key = await service.createOne({ name: 'x' });

			expect(key).toBe(1);
		});

		it(oneLine`
			updateMany with accountability runs validateAccess + processPayload
		`, async () => {
			tracker.on.select('test').response([{ id: 1, name: 'y' }]);
			tracker.on.update('test').response(1);

			const service = new ItemsService('test', {
				knex: db,
				schema: shapesSchema,
				accountability,
			});

			const keys = await service.updateMany([1], { name: 'y' });

			expect(keys).toEqual([1]);
		});
	});

	describe(oneLine`
		onRequireUserIntegrityCheck callback bubbles the flags up instead of validating
	`, () => {
		const onRequireUserIntegrityCheck = vi.fn();
		const flags = UserIntegrityCheckFlag.All;

		afterEach(() => {
			onRequireUserIntegrityCheck.mockClear();
		});

		it('createMany defers to the callback', async () => {
			tracker.on.insert('test').response([1]);

			const service = new ItemsService('test', { knex: db, schema: shapesSchema });

			await service.createMany([{ name: 'x' }], {
				userIntegrityCheckFlags: flags,
				onRequireUserIntegrityCheck,
			});

			expect(onRequireUserIntegrityCheck).toHaveBeenCalledWith(flags);
		});

		it('updateMany defers to the callback', async () => {
			tracker.on.update('test').response(1);

			const service = new ItemsService('test', { knex: db, schema: shapesSchema });

			await service.updateMany([1], { name: 'y' }, {
				userIntegrityCheckFlags: flags,
				onRequireUserIntegrityCheck,
			});

			expect(onRequireUserIntegrityCheck).toHaveBeenCalledWith(flags);
		});

		it('deleteMany defers to the callback', async () => {
			tracker.on.delete('test').response(1);

			const service = new ItemsService('test', { knex: db, schema: shapesSchema });

			await service.deleteMany([1], {
				userIntegrityCheckFlags: flags,
				onRequireUserIntegrityCheck,
			});

			expect(onRequireUserIntegrityCheck).toHaveBeenCalledWith(flags);
		});

		it('updateBatch defers to the callback', async () => {
			tracker.on.update('test').response(1);

			const service = new ItemsService('test', { knex: db, schema: shapesSchema });

			await service.updateBatch([{ id: 1, name: 'y' }], {
				userIntegrityCheckFlags: flags,
				onRequireUserIntegrityCheck,
			});

			expect(onRequireUserIntegrityCheck).toHaveBeenCalledWith(flags);
		});
	});

	describe('misc reachable branches', () => {
		it('updateBatch throws when a batched item misses its primary key', async () => {
			const service = new ItemsService('test', { knex: db, schema: shapesSchema });

			await expect(service.updateBatch([{ name: 'no-pk' }])).rejects.toThrow(/misses primary key/);
		});

		it('upsertOne updates when the primary key already exists', async () => {
			tracker.on.select('test').response([{ id: 1 }]);
			tracker.on.update('test').response(1);

			const service = new ItemsService('test', { knex: db, schema: shapesSchema });
			const key = await service.upsertOne({ id: 1, name: 'y' });

			expect(key).toBe(1);
		});

		it('updateMany translates a DB error raised by the UPDATE', async () => {
			tracker.on.update('test').simulateError('boom');

			const service = new ItemsService('test', { knex: db, schema: shapesSchema });

			await expect(service.updateMany([1], { name: 'y' })).rejects.toThrow();
		});

		it('readByQuery honours an explicit stripNonRequested=false', async () => {
			tracker.on.select('test').response([{ id: 1, name: 'a' }]);

			const service = new ItemsService('test', { knex: db, schema: shapesSchema });
			const result = await service.readByQuery({}, { stripNonRequested: false });

			expect(result).toEqual([{ id: 1, name: 'a' }]);
		});
	});

	describe('auto-derived scoped-cache paths', () => {
		const pathSchema = new SchemaBuilder()
			.collection('sub', (c) => {
				c.field('id').id();
				c.field('name').string();
				c.field('item').m2o('item');
			})
			.collection('item', (c) => {
				c.field('id').id();
				c.field('owner').m2o('owner');
			})
			.collection('owner', (c) => {
				c.field('id').id();
			})
			.build();

		// SchemaBuilder can't set scoped_cache_fields, so inject them. `item` is an M2O
		// whose target scopes `owner`, so a 2-hop `item.owner` path auto-composes; the
		// explicit `item.owner` dedups against it; `name.foo` has a scalar head so it
		// resolves to null and drops to the bare tag.
		pathSchema.collections['sub']!.scopedCacheFields = [
			'item',
			'item.owner',
			'name.foo',
		];

		pathSchema.collections['item']!.scopedCacheFields = ['owner'];

		it('readByQuery resolves M2O paths, drops scalar heads', async () => {
			tracker.on.select('sub').response([{ id: 1, name: 'a', item: 10 }]);

			const service = new ItemsService('sub', { knex: db, schema: pathSchema });
			const result = await service.readByQuery({ fields: ['*'] });

			expect(readMeta(result)?.scopedCacheTags).toBeDefined();
		});
	});

	describe('the nested collections of a read', () => {
		const nestedSchema = new SchemaBuilder()
			.collection('owner', (c) => {
				c.field('id').id();
				c.field('space').string();
			})
			.collection('owned_item', (c) => {
				c.field('id').id();
				c.field('label').string();
				c.field('owner').m2o('owner');
				c.field('owned_sub_items').o2m('owned_sub_item', 'owned_item');
			})
			.collection('owned_sub_item', (c) => {
				c.field('id').id();
				c.field('owned_item').m2o('owned_item');
			})
			.build();

		// The read path only builds tags — writing them is respond.ts's job — so naming
		// a Redis config is enough to reach it, with no client involved.
		beforeEach(() => {
			env['CACHE_AUTO_PURGE_MODE'] = 'scoped';
			env['CACHE_STORE'] = 'redis';
			env['REDIS_ENABLED'] = true;
			// `run-ast` pages a to-many until a batch comes back short, and an
			// unset size compares every length as under it — an endless loop.
			env['RELATIONAL_BATCH_SIZE'] = 250;
		});

		afterEach(() => {
			delete env['CACHE_AUTO_PURGE_MODE'];
			delete env['CACHE_STORE'];
			delete env['REDIS_ENABLED'];
			delete env['RELATIONAL_BATCH_SIZE'];
		});

		it('pins an M2O parent by the key the response nested', async () => {
			tracker.on.select('owned_item').response([
				{ id: 1, label: 'a', owner: 100 },
			]);

			tracker.on.select('owner').response([{ id: 100, space: 's' }]);

			const result = await new ItemsService('owned_item', {
				knex: db,
				schema: nestedSchema,
			}).readByQuery({
				fields: ['id', 'label', 'owner.id', 'owner.space'],
			});

			const tags = readMeta(result)?.scopedCacheTags;

			expect(tags).toContainEqual({
				collection: 'owner',
				field: 'id',
				value: 100,
				type: 'integer',
			});

			// The regression this exists for: a bare tag beside the pin would make any
			// write to any owner drop the read, which is what the pin is here to stop.
			expect(tags).not.toContainEqual({ collection: 'owner' });

			// The root keeps its bare tag — its filter bounds nothing.
			expect(tags).toContainEqual({ collection: 'owned_item' });
		});

		it('keeps a collection it reached across a to-many hop bare', async () => {
			// The child's query names `owned_item` as its WHERE column, so the parent
			// matcher would claim it first — register the narrower table ahead of it.
			tracker.on.select('owned_sub_item').response([
				{ id: 7, owned_item: 1 },
			]);

			tracker.on.select('owned_item').response([
				{ id: 1, label: 'a', owner: 100 },
			]);

			const result = await new ItemsService('owned_item', {
				knex: db,
				schema: nestedSchema,
			}).readByQuery({
				fields: ['id', 'label', 'owned_sub_items.id'],
			});

			const tags = readMeta(result)?.scopedCacheTags;

			expect(tags).toContainEqual({ collection: 'owned_sub_item' });

			expect(tags).not.toContainEqual({
				collection: 'owned_sub_item',
				field: 'id',
				value: 7,
				type: 'integer',
			});
		});
	});
});
