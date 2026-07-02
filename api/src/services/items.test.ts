import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import { UserIntegrityCheckFlag } from '@directus/types';
import { oneLine } from '@directus/utils';
import knex, { type Knex } from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { getCacheValue, setCacheValue } from '../cache.js';
import { getDatabaseClient } from '../database/index.js';
import emitter from '../emitter.js';
import { tagScopedCacheKeys } from '../scoped-cache.js';
import { getReadThroughCacheKey } from '../utils/get-cache-key.js';
import { permissionsCachable } from '../utils/permissions-cachable.js';
import { readMeta } from '../utils/read-meta.js';
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
		CACHE_NAMESPACE: 'system-cache',
		MAX_BATCH_MUTATION: 100000,
		// The Integration Tests' nested-relation path dynamically loads notifications -> mail, which
		// resolves this at import time.
		EMAIL_TEMPLATES_PATH: './templates',
	};
});

vi.mock('@directus/env', () => ({ useEnv: () => env }));

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('../utils/validate-user-count-integrity.js');

vi.mock('../cache.js', () => {
	return {
		getCache: () => {
			return { cache: { clear: vi.fn(), delete: vi.fn() } };
		},
		getCacheValue: vi.fn(),
		setCacheValue: vi.fn(),
	};
});

vi.mock('../scoped-cache.js', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('../scoped-cache.js')>()),
		purgeScopedCache: vi.fn(),
		tagScopedCacheKeys: vi.fn(),
		scopedCachePurgeEnabled: () => {
			return true;
		},
	};
});

// The read-through cache guard calls permissionsCachable (real one hits the permissions DB) and
// getReadThroughCacheKey (real one hashes + probes ip_access). Stub both so the service-cache tests
// stay hermetic; permissionsCachable defaults to cachable and the key is fixed for assertions.
vi.mock('../utils/permissions-cachable.js', () => {
	return {
		permissionsCachable: vi.fn(async () => true),
	};
});

vi.mock('../utils/get-cache-key.js', () => {
	return {
		getReadThroughCacheKey: vi.fn(async () => 'read-through-key'),
	};
});

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

	describe('service-level read-through cache', () => {
		beforeEach(() => {
			env['CACHE_ENABLED'] = true;
			env['CACHE_VALUE_MAX_SIZE'] = false;
			env['CACHE_TTL'] = '5m';
			vi.mocked(permissionsCachable).mockResolvedValue(true);
			// Default every read to a miss; the hit test overrides with a one-shot value.
			vi.mocked(getCacheValue).mockResolvedValue(undefined);
		});

		afterEach(() => {
			delete env['CACHE_ENABLED'];
			delete env['CACHE_VALUE_MAX_SIZE'];
			delete env['CACHE_TTL'];
		});

		it('serves a cache hit without querying the database or re-caching', async () => {
			// No tracker.select handler: a hit must return before any DB read.
			vi.mocked(getCacheValue).mockResolvedValueOnce([{ id: 7, name: 'cached' }]);

			const service = new ItemsService('test', { knex: db, schema: shapesSchema });
			const result = await service.readByQuery({ filter: { name: { _eq: 'x' } } });

			expect(result).toEqual([{ id: 7, name: 'cached' }]);
			expect(getCacheValue).toHaveBeenCalledWith(expect.anything(), 'read-through-key');
			expect(setCacheValue).not.toHaveBeenCalled();
			expect(tagScopedCacheKeys).not.toHaveBeenCalled();
		});

		it('caches payload + expiry and tags them on a miss', async () => {
			tracker.on.select('test').response([{ id: 1, name: 'fresh' }]);

			const service = new ItemsService('test', { knex: db, schema: shapesSchema });
			const result = await service.readByQuery({});

			expect(result).toEqual([{ id: 1, name: 'fresh' }]);

			expect(getReadThroughCacheKey).toHaveBeenCalledWith(
				'test',
				expect.any(Object),
				null,
			);

			expect(setCacheValue).toHaveBeenCalledWith(
				expect.anything(),
				'read-through-key',
				[{ id: 1, name: 'fresh' }],
				expect.anything(),
			);

			expect(setCacheValue).toHaveBeenCalledWith(
				expect.anything(),
				'read-through-key__expires_at',
				expect.objectContaining({ exp: expect.any(Number) }),
			);

			expect(tagScopedCacheKeys).toHaveBeenCalledWith(
				'read-through-key',
				expect.any(Array),
			);
		});

		it('skips the cache entirely when opts.cache is false', async () => {
			tracker.on.select('test').response([{ id: 1, name: 'fresh' }]);

			const service = new ItemsService('test', { knex: db, schema: shapesSchema });
			await service.readByQuery({}, { cache: false });

			expect(getCacheValue).not.toHaveBeenCalled();
			expect(setCacheValue).not.toHaveBeenCalled();
		});

		it('never caches a system collection read', async () => {
			tracker.on.select('directus_users').response([{ id: 1, name: 'admin' }]);

			const service = new ItemsService('directus_users', {
				knex: db,
				schema: shapesSchema,
			});

			await service.readByQuery({});

			expect(getCacheValue).not.toHaveBeenCalled();
			expect(setCacheValue).not.toHaveBeenCalled();
		});

		it('skips the cache for an in-transaction (uncommitted) read', async () => {
			tracker.on.select('test').response([{ id: 1, name: 'fresh' }]);
			(db as any).isTransaction = true;

			try {
				const service = new ItemsService('test', { knex: db, schema: shapesSchema });
				await service.readByQuery({});

				expect(getCacheValue).not.toHaveBeenCalled();
				expect(setCacheValue).not.toHaveBeenCalled();
			}
			finally {
				delete (db as any).isTransaction;
			}
		});

		it('skips the cache when permissions are not cachable (dynamic $NOW)', async () => {
			vi.mocked(permissionsCachable).mockResolvedValue(false);
			tracker.on.select('test').response([{ id: 1, name: 'fresh' }]);

			const service = new ItemsService('test', { knex: db, schema: shapesSchema });
			await service.readByQuery({});

			expect(getCacheValue).not.toHaveBeenCalled();
			expect(setCacheValue).not.toHaveBeenCalled();
		});
	});
});
