import { SchemaBuilder } from '@directus/schema-builder';
import knex, { type Knex } from 'knex';
import { MockClient, createTracker, type Tracker } from 'knex-mock-client';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type MockedFunction,
} from 'vitest';

// Mirrors scoped-cache-purge.test.ts: force auto-purge on so shouldClearCache() routes to a
// truthy cache, mock the database client to postgres, and stub the scoped-cache module so the
// real redis/bus never loads. These tests only exercise pre-existing ItemsService branches
// (system-collection event names, uuid PKs, revisions, deleteByQuery, singletons) for coverage.
const env: Record<string, any> = {
	CACHE_AUTO_PURGE: true,
	CACHE_AUTO_PURGE_IGNORE_LIST: [],
	CACHE_NAMESPACE: 'system-cache',
	MAX_BATCH_MUTATION: 100000,
};

vi.mock('@directus/env', () => ({ useEnv: () => env }));

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

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

const { ItemsService } = await import('./items.js');
const { readMeta } = await import('../utils/read-meta.js');
const { UserIntegrityCheckFlag } = await import('@directus/types');

const schema = new SchemaBuilder()
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

schema.collections['settings']!.singleton = true;
schema.collections['settings']!.fields['theme']!.defaultValue = 'auto';

describe('ItemsService coverage — system collections, uuid PKs, revisions, singletons', () => {
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
		const service = () => new ItemsService('directus_users', { knex: db, schema });

		it('createOne on a system collection emits `<scope>.create` events', async () => {
			tracker.on.insert('directus_users').response([1]);

			const key = await service().createOne({ name: 'admin' });

			expect(key).toBe(1);
		});

		it('readByQuery on a system collection emits `<scope>.query/read` events', async () => {
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
		const service = () => new ItemsService('uuid_coll', { knex: db, schema });

		const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

		it('createOne formats the returned uuid primary key', async () => {
			// The PayloadService generates the uuid PK from the field's special, so the stored key
			// is a valid uuid run through formatUUID (no-op on postgres) rather than the raw input.
			tracker.on.insert('uuid_coll')
				.response([{ id: '11111111-1111-1111-1111-111111111111' }]);

			const key = await service().createOne({ name: 'x' });

			expect(key).toMatch(uuidPattern);
		});

		it('createMany formats uuid PKs through the batchInsert path (postgres returns in order)', async () => {
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
			const service = new ItemsService('test', { knex: db, schema });
			tracker.on.insert('test').response([1, 2]);

			const keys = await service.createMany([{ name: 'a' }, { name: 'b' }]);

			expect(keys).toEqual([1, 2]);
		});
	});

	describe('updateByQuery / deleteByQuery key resolution', () => {
		const service = () => new ItemsService('test', { knex: db, schema });

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

			const service = new ItemsService('settings', { knex: db, schema });
			const record = await service.readSingleton({ fields: ['*'] });

			expect(record).toEqual({ id: null, theme: 'auto' });
			expect(readMeta(record)?.scopedCacheTags).toBeDefined();
		});

		it('readSingleton returns the existing record when present', async () => {
			tracker.on.select('settings').response([{ id: 1, theme: 'dark' }]);

			const service = new ItemsService('settings', { knex: db, schema });
			const record = await service.readSingleton({ fields: ['*'] });

			expect(record).toEqual({ id: 1, theme: 'dark' });
		});

		it('upsertSingleton updates the existing singleton row', async () => {
			// The pre-read finds a row → updateOne path.
			tracker.on.select('settings').responseOnce([{ id: 1 }]);
			tracker.on.select('settings').response([{ id: 1, theme: 'dark' }]);
			tracker.on.update('settings').response(1);

			const service = new ItemsService('settings', { knex: db, schema });
			const key = await service.upsertSingleton({ theme: 'dark' });

			expect(key).toBe(1);
		});

		it('upsertSingleton creates a row when the singleton is empty', async () => {
			// The pre-read finds nothing → createOne path.
			tracker.on.select('settings').response([]);
			tracker.on.insert('settings').response([1]);

			const service = new ItemsService('settings', { knex: db, schema });
			const key = await service.upsertSingleton({ theme: 'dark' });

			expect(key).toBe(1);
		});
	});

	describe('accountability create/update run the permissions branches', () => {
		const accountability = { user: 'u1', role: 'r1', admin: false, app: true } as any;

		it('createOne with accountability runs processPayload', async () => {
			tracker.on.insert('test').response([1]);

			const service = new ItemsService('test', { knex: db, schema, accountability });
			const key = await service.createOne({ name: 'x' });

			expect(key).toBe(1);
		});

		it('updateMany with accountability runs validateAccess + processPayload', async () => {
			tracker.on.select('test').response([{ id: 1, name: 'y' }]);
			tracker.on.update('test').response(1);

			const service = new ItemsService('test', { knex: db, schema, accountability });
			const keys = await service.updateMany([1], { name: 'y' });

			expect(keys).toEqual([1]);
		});
	});

	describe('onRequireUserIntegrityCheck callback bubbles the flags up instead of validating', () => {
		const onRequireUserIntegrityCheck = vi.fn();
		const flags = UserIntegrityCheckFlag.All;

		afterEach(() => {
			onRequireUserIntegrityCheck.mockClear();
		});

		it('createMany defers to the callback', async () => {
			tracker.on.insert('test').response([1]);

			const service = new ItemsService('test', { knex: db, schema });

			await service.createMany([{ name: 'x' }], {
				userIntegrityCheckFlags: flags,
				onRequireUserIntegrityCheck,
			});

			expect(onRequireUserIntegrityCheck).toHaveBeenCalledWith(flags);
		});

		it('updateMany defers to the callback', async () => {
			tracker.on.update('test').response(1);

			const service = new ItemsService('test', { knex: db, schema });

			await service.updateMany([1], { name: 'y' }, {
				userIntegrityCheckFlags: flags,
				onRequireUserIntegrityCheck,
			});

			expect(onRequireUserIntegrityCheck).toHaveBeenCalledWith(flags);
		});

		it('deleteMany defers to the callback', async () => {
			tracker.on.delete('test').response(1);

			const service = new ItemsService('test', { knex: db, schema });

			await service.deleteMany([1], {
				userIntegrityCheckFlags: flags,
				onRequireUserIntegrityCheck,
			});

			expect(onRequireUserIntegrityCheck).toHaveBeenCalledWith(flags);
		});

		it('updateBatch defers to the callback', async () => {
			tracker.on.update('test').response(1);

			const service = new ItemsService('test', { knex: db, schema });

			await service.updateBatch([{ id: 1, name: 'y' }], {
				userIntegrityCheckFlags: flags,
				onRequireUserIntegrityCheck,
			});

			expect(onRequireUserIntegrityCheck).toHaveBeenCalledWith(flags);
		});
	});

	describe('misc reachable branches', () => {
		it('updateBatch throws when a batched item misses its primary key', async () => {
			const service = new ItemsService('test', { knex: db, schema });

			await expect(service.updateBatch([{ name: 'no-pk' }])).rejects.toThrow(/misses primary key/);
		});

		it('upsertOne updates when the primary key already exists', async () => {
			tracker.on.select('test').response([{ id: 1 }]);
			tracker.on.update('test').response(1);

			const service = new ItemsService('test', { knex: db, schema });
			const key = await service.upsertOne({ id: 1, name: 'y' });

			expect(key).toBe(1);
		});

		it('updateMany translates a DB error raised by the UPDATE', async () => {
			tracker.on.update('test').simulateError('boom');

			const service = new ItemsService('test', { knex: db, schema });

			await expect(service.updateMany([1], { name: 'y' })).rejects.toThrow();
		});

		it('readByQuery honours an explicit stripNonRequested=false', async () => {
			tracker.on.select('test').response([{ id: 1, name: 'a' }]);

			const service = new ItemsService('test', { knex: db, schema });
			const result = await service.readByQuery({}, { stripNonRequested: false });

			expect(result).toEqual([{ id: 1, name: 'a' }]);
		});
	});
});
