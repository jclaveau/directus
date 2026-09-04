import { ForbiddenError } from '@directus/errors';
import { oneLine } from '@directus/utils';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability } from '@directus/types';
import knex, { type Knex } from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { clearCacheTargets, getCache, getCacheValue } from '../cache.js';
import {
	CACHE_TIMESERIES_MAX_BUCKETS,
	CACHE_TIMESERIES_MIN_BUCKETS,
	evictCacheEntriesForPath,
	evictCacheEntry as registryEvictCacheEntry,
	getCacheStatsState,
	listCacheAnomalies,
	listCacheEntries,
	listCacheGroupLatencies,
	listPurgesCoveringEntry,
	readCacheDescriptorForRedisKey,
	readCacheTimeseries,
	readCacheTombstone,
	recordCacheConfigEvent,
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

		it('flushes exactly the requested targets for an admin', async () => {
			const service = new UtilsService({
				knex: db,
				schema,
				accountability: { user: 'admin-user', admin: true } as Accountability,
			});

			vi.mocked(recordCacheConfigEvent).mockResolvedValue();

			// Pins the runtime `{ targets }` contract that the published type mirrors:
			// a revert to the pre-11.10.1 `{ system }` shape passes `targets: undefined`
			// here and crashes on `undefined.includes` (issue #299). `system` is the
			// decoy — it must NOT leak in when only response/locks were asked for.
			await service.clearCache({ targets: ['response', 'locks'] });

			expect(clearCacheTargets).toHaveBeenCalledWith(['response', 'locks']);
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

		it('getCacheGroupLatencies rejects a non-admin user', async () => {
			await expect(nonAdminService().getCacheGroupLatencies()).rejects.toThrowError(
				oneLine`'test-user' does not have permission to inspect cache latencies
				as not being an admin`,
			);
		});

		it('getCacheTimeseries rejects a non-admin user', async () => {
			await expect(nonAdminService().getCacheTimeseries()).rejects.toThrowError(
				oneLine`'test-user' does not have permission to inspect the cache
				timeseries as not being an admin`,
			);
		});

		it('getCacheTimeseries judges the credential before the argument', async () => {
			// A bucket count nobody may ask for is refused for the credential, not
			// told it is malformed — which would answer a caller who got nothing.
			await expect(nonAdminService().getCacheTimeseries(undefined, 'five'))
				.rejects
				.toThrowError(ForbiddenError);
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

		it('getCacheGroupLatencies returns the per-node percentile rows', async () => {
			const rows = [{ path: '/items/a', method: null, query: null }];
			vi.mocked(listCacheGroupLatencies).mockResolvedValue(rows as any);

			await expect(adminService().getCacheGroupLatencies('1h')).resolves
				.toBe(rows);

			expect(listCacheGroupLatencies).toHaveBeenCalledWith(3600_000);
		});

		// The window guard every cache read shares. `GET /utils/cache*` and the MCP
		// tools both hand their value here unread, so a duration one of them accepts
		// cannot be one the other refuses.
		//
		// `getMilliseconds` answers its fallback for anything it cannot read, and
		// that fallback is `undefined` — which reads as "no window given" — so a
		// wrong *type* would quietly answer the 24h default while a wrong *string*
		// was refused.
		it.each([
			['a word', 'yesterday'],
			['null', null],
			['a boolean', true],
			['a list', []],
			['an object', {}],
			['empty', ''],
		])('every cache read refuses a window that is %s', async (_case, window) => {
			const service = adminService();

			await expect(service.getCacheEntries(window)).rejects
				.toThrowError(`window '${String(window)}' is not a duration`);

			await expect(service.getCacheAnomalies(window)).rejects
				.toThrowError(`window '${String(window)}' is not a duration`);

			await expect(service.getCacheGroupLatencies(window)).rejects
				.toThrowError(`window '${String(window)}' is not a duration`);

			await expect(service.getCacheTimeseries(window)).rejects
				.toThrowError(`window '${String(window)}' is not a duration`);

			// Not merely refused: no read was made under a window nobody asked for.
			expect(listCacheEntries).not.toHaveBeenCalled();
			expect(listCacheAnomalies).not.toHaveBeenCalled();
			expect(listCacheGroupLatencies).not.toHaveBeenCalled();
			expect(readCacheTimeseries).not.toHaveBeenCalled();
		});

		it.each([
			['a duration', '15m', 900_000],
			// Falsy and a valid parse, so reading it as absent would answer the
			// default window instead of the empty one that was asked for.
			['zero as text', '0', 0],
			['zero as a number', 0, 0],
			['already milliseconds', 900_000, 900_000],
			['absent', undefined, undefined],
		])('every cache read takes a window that is %s', async (
			_case,
			window,
			expected,
		) => {
			await adminService().getCacheEntries(window);

			expect(listCacheEntries).toHaveBeenCalledWith(expected);
		});

		// `Number` reads `null`, `[]` and `''` as 0 and `true` as 1 — every one of
		// them finite, so a bare finiteness check would let a value that is no
		// bucket count at all re-bucket the read. A word becomes `NaN`, which used
		// to reach the query as an Invalid Date and answer 500.
		it.each([
			['a word', 'five'],
			['null', null],
			['a boolean', true],
			['a list', []],
			['an object', {}],
			['empty', ''],
		])('getCacheTimeseries refuses a bucket count that is %s', async (
			_case,
			buckets,
		) => {
			await expect(adminService().getCacheTimeseries(undefined, buckets))
				.rejects
				.toThrowError(`buckets '${String(buckets)}' is not a number`);

			expect(readCacheTimeseries).not.toHaveBeenCalled();
		});

		// Out of range is refused rather than clamped, for the reason the window is:
		// the read clamps to these bounds, and a caller that asked for ten thousand
		// buckets and silently got five hundred goes on dividing by the count it
		// asked for. The published schema names the same two numbers.
		it.each([
			['under the floor', 0],
			['negative', -5],
			['over the ceiling', CACHE_TIMESERIES_MAX_BUCKETS + 1],
		])('getCacheTimeseries refuses a bucket count that is %s', async (
			_case,
			buckets,
		) => {
			await expect(adminService().getCacheTimeseries(undefined, buckets))
				.rejects
				.toThrowError(
					`buckets '${String(buckets)}' is outside `
					+ `${CACHE_TIMESERIES_MIN_BUCKETS}-${CACHE_TIMESERIES_MAX_BUCKETS}`,
				);

			expect(readCacheTimeseries).not.toHaveBeenCalled();
		});

		it.each([
			['a number', 12, 12],
			['text spelling one', '12', 12],
			['text around one', ' 12 ', 12],
			// The bounds themselves are inside, not outside.
			['the floor', CACHE_TIMESERIES_MIN_BUCKETS, CACHE_TIMESERIES_MIN_BUCKETS],
			['the ceiling', CACHE_TIMESERIES_MAX_BUCKETS, CACHE_TIMESERIES_MAX_BUCKETS],
			['absent', undefined, undefined],
		])('getCacheTimeseries reads a bucket count that is %s', async (
			_case,
			buckets,
			expected,
		) => {
			await adminService().getCacheTimeseries(60_000, buckets);

			expect(readCacheTimeseries).toHaveBeenCalledWith(60_000, expected);
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

			vi.mocked(readCacheDescriptorForRedisKey).mockResolvedValue({
				cacheKey: 'h1',
				lastFilled: new Date(1),
			});

			vi.mocked(listPurgesCoveringEntry).mockResolvedValue([
				{
					time: 400,
					mode: 'slices',
					collection: 'articles',
					scopedCacheTag: 'articles:id=5',
					evicted: 2,
				},
			]);

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
				filledAt: 1,
				purgesSinceFilled: [
					{
						time: 400,
						mode: 'slices',
						collection: 'articles',
						scopedCacheTag: 'articles:id=5',
						evicted: 2,
					},
				],
			});

			// Measured from the entry's own fill, not from a window.
			expect(listPurgesCoveringEntry).toHaveBeenCalledWith('h1', new Date(1));

			expect(countScopedCacheTagMembers).toHaveBeenCalledWith([
				'articles',
				'articles:id=5',
			]);
		});

		it('readCacheEntry reports an absent value with null sidecars', async () => {
			vi.mocked(getCache).mockReturnValue({ cache: mockCache } as any);
			vi.mocked(getCacheValue).mockResolvedValue(undefined);
			vi.mocked(readCacheTombstone).mockResolvedValue(null);

			vi.mocked(readCacheDescriptorForRedisKey).mockResolvedValue({
				cacheKey: 'h1',
				lastFilled: new Date(1),
			});

			vi.mocked(listPurgesCoveringEntry).mockResolvedValue([]);

			await expect(adminService().readCacheEntry('k1')).resolves.toEqual({
				exists: false,
				value: null,
				tags: null,
				tagCounts: {},
				expiry: null,
				sizes: null,
				tombstone: null,
				filledAt: 1,
				// Empty, not null: it has a fill to measure from and nothing
				// covered it since.
				purgesSinceFilled: [],
			});
		});

		it(oneLine`
			readCacheEntry cannot date purges for an entry it never described
		`, async () => {
			vi.mocked(getCache).mockReturnValue({ cache: mockCache } as any);
			vi.mocked(getCacheValue).mockResolvedValue(undefined);
			vi.mocked(readCacheTombstone).mockResolvedValue(null);
			vi.mocked(readCacheDescriptorForRedisKey).mockResolvedValue(null);

			const entry = await adminService().readCacheEntry('k1');

			// `null`, not `[]`: with no fill to measure from, answering "none"
			// would claim a proof this cannot give.
			expect(entry.purgesSinceFilled).toBeNull();
			expect(entry.filledAt).toBeNull();
			expect(listPurgesCoveringEntry).not.toHaveBeenCalled();
		});

		it('readCacheEntry returns absent without a cache', async () => {
			vi.mocked(getCache).mockReturnValue({ cache: null } as any);
			vi.mocked(readCacheDescriptorForRedisKey).mockResolvedValue(null);

			await expect(adminService().readCacheEntry('k1')).resolves.toEqual({
				exists: false,
				value: null,
				tags: null,
				tagCounts: {},
				expiry: null,
				sizes: null,
				tombstone: null,
				filledAt: null,
				purgesSinceFilled: null,
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
				budgetAlert: null,
				bufferLength: 0,
				droppedEvents: 0,
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
