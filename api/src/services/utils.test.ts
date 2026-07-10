import { ForbiddenError } from '@directus/errors';
import { oneLine } from '@directus/utils';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability } from '@directus/types';
import knex, { type Knex } from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getCache } from '../cache.js';
import {
	evictCacheEntriesForPath,
	evictCacheEntry as registryEvictCacheEntry,
	getCacheStatsState,
	listCacheEntries,
	setCacheStatsEnabled,
	truncateCacheEvents,
} from '../cache-events.js';
import { fetchAllowedFields } from '../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js';
import { validateAccess } from '../permissions/modules/validate-access/validate-access.js';
import { UtilsService } from './utils.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('../permissions/modules/validate-access/validate-access.js');
vi.mock('../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js');
vi.mock('../cache.js');
vi.mock('../cache-events.js');

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

			await expect(service.clearCache({ system: false })).rejects.toThrowError(ForbiddenError);

			await expect(service.clearCache({ system: false })).rejects.toThrowError(
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
