import { ForbiddenError } from '@directus/errors';
import { oneLine } from '@directus/utils';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability } from '@directus/types';
import knex, { type Knex } from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getCache, getCacheValue } from '../cache.js';
import {
	evictCacheEntriesForPath,
	evictCacheEntry as registryEvictCacheEntry,
	getCacheStatsState,
	listCacheAnomalies,
	listCacheEntries,
	readCacheTombstone,
	setCacheStatsEnabled,
	truncateCacheEvents,
} from '../cache-events.js';
import { fetchAllowedFields } from '../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js';
import { validateAccess } from '../permissions/modules/validate-access/validate-access.js';
import { countScopedCacheTagMembers } from '../scoped-cache.js';
import { compress } from '../utils/compress.js';
import { UtilsService } from './utils.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('../permissions/modules/validate-access/validate-access.js');
vi.mock('../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js');
vi.mock('../cache.js');
vi.mock('../cache-events.js');
vi.mock('../scoped-cache.js');
vi.mock('../utils/compress.js');

const schema = new SchemaBuilder()
	.collection('test', (c) => {
		c.field('id').id();
		c.field('sort').integer();
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
});

describe('Services / Utils', () => {
	describe('sort', () => {
		it('should throw ForbiddenError when non-admin lacks read permission on the sort field', async () => {
			tracker.on.select('directus_collections').response({ sort_field: 'sort' });

			vi.mocked(validateAccess).mockResolvedValue(undefined);
			vi.mocked(fetchAllowedFields).mockResolvedValue(['id']);

			const service = new UtilsService({
				knex: db,
				schema,
				accountability: { user: 'test-user', admin: false } as Accountability,
			});

			await expect(service.sort('test', { item: 1, to: 2 })).rejects.toThrowError(ForbiddenError);

			await expect(service.sort('test', { item: 1, to: 2 })).rejects.toThrowError(
				`'test-user' does not have permission to read the sort field 'test.sort'`,
			);
		});
	});

	describe('clearCache', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new UtilsService({
				knex: db,
				schema,
				accountability: { user: 'test-user', admin: false } as Accountability,
			});

			await expect(
				service.clearCache({ targets: ['response'] }),
			).rejects.toThrowError(ForbiddenError);

			await expect(
				service.clearCache({ targets: ['response'] }),
			).rejects.toThrowError(
				`'test-user' does not have permission to clear the cache as not being an admin`,
			);
		});
	});

	describe('cache inspection', () => {
		const nonAdmin = { user: 'test-user', admin: false } as Accountability;

		function nonAdminService() {
			return new UtilsService({ knex: db, schema, accountability: nonAdmin });
		}

		it('getCacheEntries throws ForbiddenError for non-admin user', async () => {
			const service = nonAdminService();

			await expect(service.getCacheEntries()).rejects.toThrowError(ForbiddenError);

			await expect(service.getCacheEntries()).rejects.toThrowError(
				oneLine`'test-user' does not have permission to inspect the cache
				as not being an admin`,
			);
		});

		it('evictCacheEntry throws ForbiddenError for non-admin user', async () => {
			await expect(nonAdminService().evictCacheEntry('k1')).rejects.toThrowError(
				oneLine`'test-user' does not have permission to evict a cache entry
				as not being an admin`,
			);
		});

		it('evictCacheEntriesForPath rejects a non-admin user', async () => {
			await expect(
				nonAdminService().evictCacheEntriesForPath('/items/articles'),
			).rejects.toThrowError(
				oneLine`'test-user' does not have permission to evict cache entries
				as not being an admin`,
			);
		});

		it('readCacheEntry rejects a non-admin user', async () => {
			await expect(nonAdminService().readCacheEntry('k1')).rejects.toThrowError(
				oneLine`'test-user' does not have permission to inspect a cache entry
				as not being an admin`,
			);
		});

		it('getCacheAnomalies rejects a non-admin user', async () => {
			await expect(nonAdminService().getCacheAnomalies()).rejects.toThrowError(
				oneLine`'test-user' does not have permission to inspect cache anomalies
				as not being an admin`,
			);
		});
	});

	describe('cache inspection (admin)', () => {
		const admin = { user: 'admin-user', admin: true } as Accountability;
		const mockCache = { delete: vi.fn(), clear: vi.fn() };

		function adminService() {
			return new UtilsService({ knex: db, schema, accountability: admin });
		}

		it('getCacheEntries returns the registry entries', async () => {
			const rows = [{ key: 'k1', path: '/items/a', hits: 3 }];
			vi.mocked(listCacheEntries).mockResolvedValue(rows as any);

			await expect(adminService().getCacheEntries()).resolves.toBe(rows);
		});

		it('getCacheAnomalies returns the grouped anomaly rows', async () => {
			const rows = [{ reason: 'value_too_large', path: '/items/a', count: 3 }];
			vi.mocked(listCacheAnomalies).mockResolvedValue(rows as any);

			await expect(adminService().getCacheAnomalies()).resolves.toBe(rows);
		});

		it('evictCacheEntry evicts through the active cache', async () => {
			vi.mocked(getCache).mockReturnValue({ cache: mockCache } as any);

			await adminService().evictCacheEntry('k1');

			expect(registryEvictCacheEntry).toHaveBeenCalledWith(mockCache, 'k1');
		});

		it('evictCacheEntriesForPath returns the evicted count', async () => {
			vi.mocked(getCache).mockReturnValue({ cache: mockCache } as any);
			vi.mocked(evictCacheEntriesForPath).mockResolvedValue(2);

			await expect(
				adminService().evictCacheEntriesForPath('/items/a'),
			).resolves.toBe(2);

			expect(evictCacheEntriesForPath).toHaveBeenCalledWith(mockCache, '/items/a');
		});

		it('evictCacheEntriesForPath returns 0 without a cache', async () => {
			vi.mocked(getCache).mockReturnValue({ cache: null } as any);

			await expect(
				adminService().evictCacheEntriesForPath('/items/a'),
			).resolves.toBe(0);

			expect(evictCacheEntriesForPath).not.toHaveBeenCalled();
		});

		it('readCacheEntry returns value + tags + sizes + tombstone', async () => {
			vi.mocked(getCache).mockReturnValue({ cache: mockCache } as any);

			vi.mocked(getCacheValue).mockImplementation((_cache, key) => {
				if (key === 'k1') {
					return Promise.resolve({ data: [1, 2] });
				}

				if (key === 'k1__expires_at') {
					return Promise.resolve({ exp: 5, createdAt: 1, ttlMs: 1000 });
				}

				if (key === 'k1__tags') {
					return Promise.resolve({ tags: 'articles, articles:id=5' });
				}

				return Promise.resolve(undefined);
			});

			vi.mocked(compress).mockResolvedValue(Buffer.from('abc'));
			vi.mocked(readCacheTombstone).mockResolvedValue(999);

			vi.mocked(countScopedCacheTagMembers).mockResolvedValue({
				'articles': 3,
				'articles:id=5': 7,
			});

			await expect(adminService().readCacheEntry('k1')).resolves.toEqual({
				exists: true,
				value: { data: [1, 2] },
				tags: ['articles', 'articles:id=5'],
				tagCounts: { 'articles': 3, 'articles:id=5': 7 },
				expiry: { exp: 5, createdAt: 1, ttlMs: 1000 },
				// '{"data":[1,2]}' = 14 bytes raw; the mocked compress = 3.
				sizes: { uncompressed: 14, compressed: 3 },
				tombstone: 999,
			});

			expect(countScopedCacheTagMembers).toHaveBeenCalledWith([
				'articles',
				'articles:id=5',
			]);
		});

		it('readCacheEntry reports an absent value with null sidecars', async () => {
			vi.mocked(getCache).mockReturnValue({ cache: mockCache } as any);
			vi.mocked(getCacheValue).mockResolvedValue(undefined);
			vi.mocked(readCacheTombstone).mockResolvedValue(null);

			await expect(adminService().readCacheEntry('k1')).resolves.toEqual({
				exists: false,
				value: null,
				tags: null,
				tagCounts: {},
				expiry: null,
				sizes: null,
				tombstone: null,
			});
		});

		it('readCacheEntry returns absent without a cache', async () => {
			vi.mocked(getCache).mockReturnValue({ cache: null } as any);

			await expect(adminService().readCacheEntry('k1')).resolves.toEqual({
				exists: false,
				value: null,
				tags: null,
				tagCounts: {},
				expiry: null,
				sizes: null,
				tombstone: null,
			});

			expect(getCacheValue).not.toHaveBeenCalled();
		});
	});

	describe('cache stats', () => {
		const admin = { user: 'admin-user', admin: true } as Accountability;
		const nonAdmin = { user: 'test-user', admin: false } as Accountability;

		function service(accountability: Accountability) {
			return new UtilsService({ knex: db, schema, accountability });
		}

		it('getCacheStatsState rejects a non-admin user', async () => {
			await expect(service(nonAdmin).getCacheStatsState()).rejects.toThrowError(
				ForbiddenError,
			);
		});

		it('getCacheStatsState returns the state for an admin', async () => {
			const state = {
				configured: true,
				enabled: true,
				killedReason: null,
				bufferLength: 0,
			};

			vi.mocked(getCacheStatsState).mockResolvedValue(state);

			await expect(service(admin).getCacheStatsState()).resolves.toBe(state);
		});

		it('setCacheStatsEnabled rejects a non-admin user', async () => {
			await expect(
				service(nonAdmin).setCacheStatsEnabled(false),
			).rejects.toThrowError(ForbiddenError);

			expect(setCacheStatsEnabled).not.toHaveBeenCalled();
		});

		it('setCacheStatsEnabled delegates for an admin', async () => {
			await service(admin).setCacheStatsEnabled(false);
			expect(setCacheStatsEnabled).toHaveBeenCalledWith(false);
		});

		it('truncateCacheStats rejects a non-admin user', async () => {
			await expect(service(nonAdmin).truncateCacheStats()).rejects.toThrowError(
				ForbiddenError,
			);

			expect(truncateCacheEvents).not.toHaveBeenCalled();
		});

		it('truncateCacheStats delegates for an admin', async () => {
			await service(admin).truncateCacheStats();
			expect(truncateCacheEvents).toHaveBeenCalled();
		});
	});
});
