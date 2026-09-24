import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import { oneLine } from '@directus/utils';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability, AutoscaleConfig } from '@directus/types';
import knex, { type Knex } from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCacheTargets, getCache, getCacheValue } from '../cache.js';
import {
	listCacheAuditRuns,
	readCacheAuditFindings,
	readCacheAuditRun,
	runCacheAudit,
} from '../cache-audit-runs.js';
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
	readCacheAuditQueueState,
	readCacheDescriptorForRedisKey,
	readCacheTimeseries,
	readCacheTombstone,
	recordCacheConfigEvent,
	setCacheStatsEnabled,
	truncateCacheEvents,
} from '../cache-events.js';
import {
	drillState,
	loadedWorker,
	startDrill,
	stopDrill,
} from '../processes/autoscale/lib/drill.js';
import {
	askForReload,
	reloadRefusal,
} from '../processes/autoscale/lib/reload.js';
import {
	applySharedSettingsPatch,
	parseSharedSettingsPatch,
} from '../processes/autoscale/lib/shared-settings.js';
import {
	configWithSharedSettings,
} from '../processes/autoscale/lib/resolve-config.js';
import {
	applySupervisorPatch,
	parseSupervisorPatch,
} from '../processes/autoscale/lib/supervisor-shared-settings.js';
import {
	SHARED_SETTINGS_COLUMNS,
	readAllSharedSettings,
	readSharedSettings,
	writeSharedSettings,
} from '../processes/lib/shared-settings.js';
import { collectProcesses, processesReportEnabled } from '../processes/index.js';
import { fetchAllowedFields } from '../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js';
import { validateAccess } from '../permissions/modules/validate-access/validate-access.js';
import {
	cacheAuditScheduleState,
	refreshCacheAuditScheduleOverride,
} from '../schedules/cache-audit.js';
import { countScopedCachePinMembers } from '../scoped-cache.js';
import { compress } from '../utils/compress.js';
import { SettingsService } from './settings.js';
import { UtilsService } from './utils.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('../permissions/modules/validate-access/validate-access.js');
vi.mock('../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js');
vi.mock('../cache.js');
vi.mock('../cache-audit-runs.js');
vi.mock('../schedules/cache-audit.js');
vi.mock('../cache-events.js');
vi.mock('../scoped-cache.js');
vi.mock('../utils/compress.js');
vi.mock('../processes/autoscale/lib/drill.js');
vi.mock('../processes/autoscale/lib/reload.js');
vi.mock('../processes/autoscale/lib/shared-settings.js');
vi.mock('../processes/autoscale/lib/supervisor-shared-settings.js');
vi.mock('../processes/index.js');
vi.mock('../processes/autoscale/lib/resolve-config.js');

// Named here rather than taken from the module, so the columns the service
// reads and writes are pinned by the test rather than by whatever it imports.
vi.mock('../processes/lib/shared-settings.js', () => {
	return {
		SHARED_SETTINGS_COLUMNS: {
			autoscale: 'autoscale_settings',
			supervisor: 'supervisor_settings',
		},
		readAllSharedSettings: vi.fn(),
		readSharedSettings: vi.fn(),
		writeSharedSettings: vi.fn(),
	};
});

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

		function adminService() {
			return new UtilsService({
				knex: db,
				schema,
				accountability: { user: 'admin', admin: true } as Accountability,
			});
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

		it('auditCache rejects a non-admin user', async () => {
			await expect(nonAdminService().auditCache()).rejects.toThrowError(
				oneLine`'test-user' does not have permission to audit the cache
				as not being an admin`,
			);

			expect(runCacheAudit).not.toHaveBeenCalled();
		});

		it(oneLine`
			auditCache hands the options to a recorded run, as REST unless told
			otherwise, and answers the run as the history recorded it
		`, async () => {
			const report = { id: 4, scanned: 1, counts: { stale: 0 }, findings: [] };
			vi.mocked(runCacheAudit).mockResolvedValue(report as any);
			const run = { id: 4, trigger: 'rest', scanned: 1 };
			vi.mocked(readCacheAuditRun).mockResolvedValue(run as any);

			await expect(
				adminService().auditCache({ limit: 5, purge: true }),
			).resolves.toBe(run);

			expect(runCacheAudit).toHaveBeenCalledWith('rest', { limit: 5, purge: true });
			expect(readCacheAuditRun).toHaveBeenCalledWith(4);

			await adminService().auditCache({}, 'mcp');

			expect(runCacheAudit).toHaveBeenLastCalledWith('mcp', {});
		});

		it('auditCache refuses to answer a run the history does not hold', async () => {
			vi.mocked(runCacheAudit).mockResolvedValue({ id: 4 } as any);
			vi.mocked(readCacheAuditRun).mockResolvedValue(null);

			await expect(adminService().auditCache()).rejects.toThrowError(
				'Cache audit run 4 was not recorded',
			);
		});

		it('getCacheAudits refuses a non-admin, and lists for an admin', async () => {
			await expect(nonAdminService().getCacheAudits()).rejects.toThrowError(
				oneLine`'test-user' does not have permission to inspect the cache audits
				as not being an admin`,
			);

			const runs = [{ id: 1 }];
			vi.mocked(listCacheAuditRuns).mockResolvedValue(runs as any);

			await expect(adminService().getCacheAudits('2d')).resolves.toBe(runs);

			expect(listCacheAuditRuns).toHaveBeenCalledWith(172_800_000);
		});

		it(oneLine`
			getCacheAudit reads one run with the first page of its findings,
			refusing an id that is none
		`, async () => {
			const run = { id: 7, trigger: 'rest' };
			vi.mocked(readCacheAuditRun).mockResolvedValue(run as any);

			const page = { findings: [{ verdict: 'stale' }], findingsTotal: 41 };
			vi.mocked(readCacheAuditFindings).mockResolvedValue(page as any);

			await expect(adminService().getCacheAudit('7')).resolves.toEqual({
				...run,
				...page,
			});

			expect(readCacheAuditRun).toHaveBeenCalledWith(7);

			expect(readCacheAuditFindings).toHaveBeenCalledWith(7, {
				limit: 100,
				offset: 0,
			});

			for (const bad of ['seven', '0', '1.5', undefined]) {
				await expect(adminService().getCacheAudit(bad)).rejects.toThrowError(
					'is not an audit id',
				);
			}
		});

		it(oneLine`
			getCacheAudit takes the page as sent, one verdict when asked, and
			refuses a page it cannot cut
		`, async () => {
			vi.mocked(readCacheAuditRun).mockResolvedValue({ id: 7 } as any);

			vi.mocked(readCacheAuditFindings).mockResolvedValue({
				findings: [],
				findingsTotal: 0,
			});

			await adminService().getCacheAudit(7, {
				limit: '10',
				offset: '30',
				verdict: 'pin_drift',
				window: '7d',
			});

			expect(readCacheAuditFindings).toHaveBeenCalledWith(7, {
				limit: 10,
				offset: 30,
				verdict: 'pin_drift',
			});

			for (const bad of [
				{ limit: 0 },
				{ limit: 1001 },
				{ offset: -1 },
				{ verdict: 'fresh' },
				{ verdict: 'wrong' },
			]) {
				await expect(adminService().getCacheAudit(7, bad)).rejects.toBeInstanceOf(
					InvalidPayloadError,
				);
			}

			expect(readCacheAuditRun).toHaveBeenCalledTimes(1);
		});

		it('getCacheAudit answers a run nobody recorded as forbidden', async () => {
			vi.mocked(readCacheAuditRun).mockResolvedValue(null);

			await expect(adminService().getCacheAudit(99)).rejects.toBeInstanceOf(
				ForbiddenError,
			);
		});

		it('getCacheAuditSchedule answers the state in force to an admin', async () => {
			await expect(nonAdminService().getCacheAuditSchedule()).rejects.toThrowError(
				oneLine`'test-user' does not have permission to inspect the cache audit
				schedule as not being an admin`,
			);

			const state = { rule: '0 3 * * *', source: 'env' };
			vi.mocked(cacheAuditScheduleState).mockReturnValue(state as any);

			await expect(adminService().getCacheAuditSchedule()).resolves.toBe(state);
		});

		it('getCacheAuditQueue answers the queue state to an admin', async () => {
			await expect(nonAdminService().getCacheAuditQueue()).rejects.toThrowError(
				oneLine`'test-user' does not have permission to inspect the cache audit
				queue as not being an admin`,
			);

			const state = { size: 40, neverAudited: 3, verifiedSince: 1_700_000_000_000 };
			vi.mocked(readCacheAuditQueueState).mockResolvedValue(state);

			await expect(adminService().getCacheAuditQueue()).resolves.toBe(state);
		});

		it(oneLine`
			updateCacheAuditSchedule writes through the settings singleton and
			answers the value it just wrote
		`, async () => {
			// The settings service is a real ItemsService underneath, which reads
			// the cache handle on construction.
			vi.mocked(getCache).mockReturnValue({ cache: null } as any);

			const upsert = vi
				.spyOn(SettingsService.prototype, 'upsertSingleton')
				.mockResolvedValue(1);

			const state = { rule: '0 4 * * *', source: 'settings' };
			vi.mocked(cacheAuditScheduleState).mockReturnValue(state as any);

			await expect(adminService().updateCacheAuditSchedule('0 4 * * *'))
				.resolves.toBe(state);

			expect(upsert).toHaveBeenCalledWith({ cache_audit_schedule: '0 4 * * *' });
			expect(refreshCacheAuditScheduleOverride).toHaveBeenCalledOnce();

			await adminService().updateCacheAuditSchedule(null);

			expect(upsert).toHaveBeenLastCalledWith({ cache_audit_schedule: null });
		});

		it('updateCacheAuditSchedule refuses a rule neither text nor null', async () => {
			await expect(adminService().updateCacheAuditSchedule(5)).rejects.toThrowError(
				'`rule` has to be a cron rule, or null to clear the override',
			);

			await expect(nonAdminService().updateCacheAuditSchedule(null))
				.rejects.toThrowError(
					oneLine`'test-user' does not have permission to change the cache
					audit schedule as not being an admin`,
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

		it('readCacheEntry returns value + pins + sizes + tombstone', async () => {
			vi.mocked(getCache).mockReturnValue({ cache: mockCache } as any);

			vi.mocked(getCacheValue).mockImplementation((_cache, key) => {
				if (key === 'k1') {
					return Promise.resolve({ data: [1, 2] });
				}

				if (key === 'k1__expires_at') {
					return Promise.resolve({ exp: 5, createdAt: 1, ttlMs: 1000 });
				}

				if (key === 'k1__pins') {
					return Promise.resolve({ pins: ['articles', 'articles:id=5'] });
				}

				return Promise.resolve(undefined);
			});

			vi.mocked(compress).mockResolvedValue(Buffer.from('abc'));
			vi.mocked(readCacheTombstone).mockResolvedValue(999);

			vi.mocked(readCacheDescriptorForRedisKey).mockResolvedValue({
				cacheKey: 'h1',
				lastFilled: new Date(1),
				auditedAt: new Date(3),
			});

			vi.mocked(listPurgesCoveringEntry).mockResolvedValue([
				{
					time: 400,
					mode: 'slices',
					collection: 'articles',
					scopedCachePin: 'articles:id=5',
					evicted: 2,
				},
			]);

			vi.mocked(countScopedCachePinMembers).mockResolvedValue({
				'articles': 3,
				'articles:id=5': 7,
			});

			await expect(adminService().readCacheEntry('k1')).resolves.toEqual({
				exists: true,
				value: { data: [1, 2] },
				pins: ['articles', 'articles:id=5'],
				pinCounts: { 'articles': 3, 'articles:id=5': 7 },
				expiry: { exp: 5, createdAt: 1, ttlMs: 1000 },
				// '{"data":[1,2]}' = 14 bytes raw; the mocked compress = 3.
				sizes: { uncompressed: 14, compressed: 3 },
				tombstone: 999,
				filledAt: 1,
				auditedAt: 3,
				// Known good as of the audit, which came after the fill.
				verifiedAt: 3,
				purgesSinceFilled: [
					{
						time: 400,
						mode: 'slices',
						collection: 'articles',
						scopedCachePin: 'articles:id=5',
						evicted: 2,
					},
				],
			});

			// Measured from the entry's own fill, not from a window.
			expect(listPurgesCoveringEntry).toHaveBeenCalledWith('h1', new Date(1));

			expect(countScopedCachePinMembers).toHaveBeenCalledWith([
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
				auditedAt: null,
			});

			vi.mocked(listPurgesCoveringEntry).mockResolvedValue([]);

			await expect(adminService().readCacheEntry('k1')).resolves.toEqual({
				exists: false,
				value: null,
				pins: null,
				pinCounts: {},
				expiry: null,
				sizes: null,
				tombstone: null,
				filledAt: 1,
				auditedAt: null,
				// Never audited: the fill is the last time it was known good.
				verifiedAt: 1,
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
			expect(entry.verifiedAt).toBeNull();
			expect(listPurgesCoveringEntry).not.toHaveBeenCalled();
		});

		it('readCacheEntry returns absent without a cache', async () => {
			vi.mocked(getCache).mockReturnValue({ cache: null } as any);
			vi.mocked(readCacheDescriptorForRedisKey).mockResolvedValue(null);

			await expect(adminService().readCacheEntry('k1')).resolves.toEqual({
				exists: false,
				value: null,
				pins: null,
				pinCounts: {},
				expiry: null,
				sizes: null,
				tombstone: null,
				filledAt: null,
				auditedAt: null,
				verifiedAt: null,
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

	describe('autoscale configuration', () => {
		const admin = { user: 'admin-id', admin: true } as Accountability;

		function service(accountability: Accountability) {
			return new UtilsService({ knex: db, schema, accountability });
		}

		// What the env chain resolves under the shared settings, which is what the
		// write is judged against.
		function resolvesTo(config: Partial<AutoscaleConfig>) {
			vi.mocked(configWithSharedSettings).mockReturnValue({
				enabled: true,
				strategy: 'scalabus',
				appName: 'api',
				signal: 'average',
				sampleWindow: 5,
				scaleCpuThreshold: 60,
				releaseCpuThreshold: 40,
				minWorkers: 1,
				maxWorkers: 4,
				prewarmWorkers: 0,
				minSecondsToScaleUp: 10,
				minSecondsToScaleDown: 300,
				warmupSeconds: 30,
				...config,
			});
		}

		/** What each column answers with, one read standing for both. */
		function holding(columns: {
			autoscale?: Record<string, unknown> | null;
			supervisor?: Record<string, unknown> | null;
		}) {
			vi.mocked(readSharedSettings).mockImplementation(async (column) => {
				return column === SHARED_SETTINGS_COLUMNS.autoscale
					? columns.autoscale ?? null
					: columns.supervisor ?? null;
			});

			vi.mocked(readAllSharedSettings).mockResolvedValue({
				[SHARED_SETTINGS_COLUMNS.autoscale]: columns.autoscale ?? null,
				[SHARED_SETTINGS_COLUMNS.supervisor]: columns.supervisor ?? null,
			});
		}

		function stored(sharedSettings: Record<string, unknown> | null) {
			resolvesTo({});
			holding({ autoscale: sharedSettings });

			vi.mocked(parseSharedSettingsPatch).mockImplementation((patch) => patch);

			vi.mocked(applySharedSettingsPatch)
				.mockImplementation((_current, patch) => patch);
		}

		// The stamp keeps the id, which outlives a rename; a page asked to show
		// who left shared settings wants the address, and only the table has it.
		it('names the user behind the id it stamped', async () => {
			stored({ maxWorkers: 8, setBy: 'writer-id' });
			tracker.on.select('directus_users').response({ email: 'ann@example.com' });

			await expect(service(admin).readAutoscaleConfig()).resolves.toMatchObject({
				key: 'directus_settings.autoscale_settings',
				sharedSettings: { maxWorkers: 8, setBy: 'writer-id' },
				setByEmail: 'ann@example.com',
			});
		});

		// One page shows both, and a value it displays cannot be attributed to
		// the configuration or to the supervisor unless the read carries each.
		it('answers the supervisor options beside the configuration', async () => {
			stored(null);

			holding({ supervisor: { listenTimeout: 20_000 } });

			await expect(service(admin).readAutoscaleConfig()).resolves.toMatchObject({
				supervisor: { sharedSettings: { listenTimeout: 20_000 } },
			});
		});

		// The key is editable by hand, and a database asked to match a uuid
		// against whatever was typed there refuses the comparison.
		it('names nobody where the id matches no user', async () => {
			stored({ maxWorkers: 8, setBy: 'not-an-id' });
			tracker.on.select('directus_users').simulateError('invalid input syntax');

			await expect(service(admin).readAutoscaleConfig())
				.resolves
				.toMatchObject({ setByEmail: null });
		});

		it('stamps the surface the change came in through', async () => {
			stored(null);
			tracker.on.select('directus_users').response({ email: 'ann@example.com' });

			await service(admin).updateAutoscaleConfig({ maxWorkers: 8 }, 'mcp');

			expect(writeSharedSettings).toHaveBeenCalledWith(
				SHARED_SETTINGS_COLUMNS.autoscale,
				expect.objectContaining({ setBy: 'admin-id', setFrom: 'mcp' }),
				expect.anything(),
			);
		});

		// The loop clamps what it is handed, which is the wrong answer to a
		// write: an operator watching a ceiling be ignored cannot tell a
		// corrected value from a refused one.
		it('refuses a configuration the loop would have to correct', async () => {
			stored({ maxWorkers: 4 });
			resolvesTo({ minWorkers: 8, maxWorkers: 4 });

			await expect(service(admin).updateAutoscaleConfig({ minWorkers: 8 }, 'admin'))
				.rejects
				.toThrowError(`'minWorkers' is 8, above the 'maxWorkers' ceiling of 4`);

			expect(writeSharedSettings).not.toHaveBeenCalled();
		});

		it('refuses a non-admin', async () => {
			const nonAdmin = { user: 'test-user', admin: false } as Accountability;

			await expect(service(nonAdmin).updateAutoscaleConfig({}, 'admin'))
				.rejects
				.toThrowError(ForbiddenError);

			expect(writeSharedSettings).not.toHaveBeenCalled();
		});

		// Clearing writes the absence rather than the resolved values, so the
		// env chain is what answers again afterwards.
		it('clears the shared settings by writing none at all', async () => {
			await service(admin).clearAutoscaleConfig();

			expect(writeSharedSettings).toHaveBeenCalledWith(
				SHARED_SETTINGS_COLUMNS.autoscale,
				null,
				expect.anything(),
			);
		});

		it('refuses a non-admin clearing it', async () => {
			const nonAdmin = { user: 'test-user', admin: false } as Accountability;

			await expect(service(nonAdmin).clearAutoscaleConfig())
				.rejects
				.toThrowError(ForbiddenError);

			expect(writeSharedSettings).not.toHaveBeenCalled();
		});
	});

	describe('supervisor options', () => {
		const admin = { user: 'admin-id', admin: true } as Accountability;
		const nonAdmin = { user: 'test-user', admin: false } as Accountability;

		function service(accountability: Accountability) {
			return new UtilsService({ knex: db, schema, accountability });
		}

		beforeEach(() => {
			vi.mocked(readSharedSettings).mockResolvedValue(null);
			vi.mocked(parseSupervisorPatch).mockImplementation((patch) => patch);

			vi.mocked(applySupervisorPatch)
				.mockImplementation((_current, patch) => patch);
		});

		// Nothing reads these but pm2, when it starts a worker, so the write is
		// stamped with where it came from exactly as the configuration's is.
		it('stamps the surface the change came in through', async () => {
			tracker.on.select('directus_users').response({ email: 'ann@example.com' });

			await expect(service(admin).updateSupervisorConfig(
				{ listenTimeout: 20_000 },
				'mcp',
			)).resolves.toMatchObject({
				key: 'directus_settings.supervisor_settings',
			});

			expect(writeSharedSettings).toHaveBeenCalledWith(
				SHARED_SETTINGS_COLUMNS.supervisor,
				expect.objectContaining({
					listenTimeout: 20_000,
					setBy: 'admin-id',
					setFrom: 'mcp',
				}),
				expect.anything(),
			);
		});

		it('refuses a non-admin', async () => {
			await expect(service(nonAdmin).updateSupervisorConfig({}, 'admin'))
				.rejects
				.toThrowError(ForbiddenError);

			expect(writeSharedSettings).not.toHaveBeenCalled();
		});
	});

	describe('autoscale runners', () => {
		const admin = { user: 'admin-id', admin: true } as Accountability;
		const nonAdmin = { user: 'test-user', admin: false } as Accountability;

		function service(accountability: Accountability) {
			return new UtilsService({ knex: db, schema, accountability });
		}

		// One deployment answers with a tree; what the panel and every refusal
		// read is the flat list of the processes that actually scale a pool.
		it('flattens the report down to the processes that scale', async () => {
			vi.mocked(processesReportEnabled).mockReturnValue(true);

			vi.mocked(collectProcesses).mockResolvedValue({
				services: [
					{
						service: 'api',
						replicas: [
							{
								replicaId: 'one',
								processes: [
									{ nodeId: 'a', name: 'autoscaler', autoscale: { workers: 2 } },
									{ nodeId: 'b', name: 'api', autoscale: null },
								],
							},
						],
					},
				],
			} as any);

			await expect(service(admin).readAutoscaleRunners()).resolves.toEqual([
				{
					service: 'api',
					replicaId: 'one',
					nodeId: 'a',
					name: 'autoscaler',
					state: { workers: 2 },
				},
			]);
		});

		// Collecting one would wait out the reply window to build the empty tree
		// the caller already knows it would get.
		it('asks nobody where the report is off', async () => {
			vi.mocked(processesReportEnabled).mockReturnValue(false);

			await expect(service(admin).readAutoscaleRunners()).resolves.toEqual([]);
			expect(collectProcesses).not.toHaveBeenCalled();
		});

		it('refuses a non-admin', async () => {
			vi.mocked(processesReportEnabled).mockReturnValue(true);

			await expect(service(nonAdmin).readAutoscaleRunners())
				.rejects
				.toThrowError(ForbiddenError);

			expect(collectProcesses).not.toHaveBeenCalled();
		});
	});

	describe('autoscale rolling restart', () => {
		const admin = { user: 'admin-id', admin: true } as Accountability;
		const nonAdmin = { user: 'test-user', admin: false } as Accountability;

		function service(accountability: Accountability) {
			return new UtilsService({ knex: db, schema, accountability });
		}

		beforeEach(() => {
			// What the pool looks like comes off the processes report, and reading
			// a refusal out of it is `reloadRefusal` — mocked here, checked in
			// `reload.test.ts`.
			vi.mocked(processesReportEnabled).mockReturnValue(false);
		});

		it('answers with what the asking worker can say for certain', async () => {
			vi.mocked(reloadRefusal).mockReturnValue(null);

			vi.mocked(askForReload).mockReturnValue({
				askedAt: 1000,
				running: false,
				finishedAt: null,
				error: null,
			});

			await expect(service(admin).startAutoscaleReload())
				.resolves
				.toEqual({
					askedAt: 1000,
					running: false,
					finishedAt: null,
					error: null,
				});
		});

		// Refused at the asking end and not only greyed out in the page: a pool
		// that cannot overlap its workers would be stopped rather than rolled.
		it('refuses a pool the supervisor could not roll', async () => {
			vi.mocked(reloadRefusal).mockReturnValue('the pool runs in fork_mode');

			await expect(service(admin).startAutoscaleReload())
				.rejects
				.toThrowError('the pool runs in fork_mode');

			expect(askForReload).not.toHaveBeenCalled();
		});

		it('refuses a non-admin', async () => {
			vi.mocked(reloadRefusal).mockReturnValue(null);

			await expect(service(nonAdmin).startAutoscaleReload())
				.rejects
				.toThrowError(ForbiddenError);

			expect(askForReload).not.toHaveBeenCalled();
		});
	});

	describe('autoscale load drill', () => {
		const admin = { user: 'admin-id', admin: true } as Accountability;
		const nonAdmin = { user: 'test-user', admin: false } as Accountability;

		function service(accountability: Accountability) {
			return new UtilsService({ knex: db, schema, accountability });
		}

		beforeEach(() => {
			// The runners come off the processes report, and what they say is what
			// `loadedWorker` is asked about — mocked here, checked in `drill.test.ts`.
			vi.mocked(processesReportEnabled).mockReturnValue(false);
		});

		it('answers with the deadline the pool was given', async () => {
			vi.mocked(loadedWorker).mockReturnValue(null);
			vi.mocked(startDrill).mockReturnValue({ until: 1000, percent: 80 });

			await expect(service(admin).startAutoscaleDrill('30', '80'))
				.resolves
				.toEqual({ until: 1000, percent: 80 });

			expect(startDrill).toHaveBeenCalledWith(30, 80);
		});

		// A drill laid over real traffic buys workers for load nobody asked to
		// serve, and measures the two together.
		it('refuses a drill over a pool that is already working', async () => {
			vi.mocked(loadedWorker).mockReturnValue(41);

			await expect(service(admin).startAutoscaleDrill(30, 80))
				.rejects
				.toThrowError('a worker is at 41% CPU');

			expect(startDrill).not.toHaveBeenCalled();
		});

		it('refuses a drill longer than a worker will run one for', async () => {
			vi.mocked(loadedWorker).mockReturnValue(null);

			await expect(service(admin).startAutoscaleDrill(600, 80))
				.rejects
				.toThrowError(`'seconds' has to be a whole number between 1 and 120`);

			expect(startDrill).not.toHaveBeenCalled();
		});

		it('refuses a share outside what a worker will burn', async () => {
			vi.mocked(loadedWorker).mockReturnValue(null);

			await expect(service(admin).startAutoscaleDrill(30, 200))
				.rejects
				.toThrowError(`'percent' has to be a whole number between 10 and 95`);

			expect(startDrill).not.toHaveBeenCalled();
		});

		it('stops a drill and reads back what this worker is burning', async () => {
			vi.mocked(stopDrill).mockReturnValue({ until: null, percent: 80 });
			vi.mocked(drillState).mockReturnValue({ until: 2000, percent: 80 });

			await expect(service(admin).stopAutoscaleDrill())
				.resolves
				.toEqual({ until: null, percent: 80 });

			await expect(service(admin).readAutoscaleDrill())
				.resolves
				.toEqual({ until: 2000, percent: 80 });
		});

		it('refuses a non-admin', async () => {
			await expect(service(nonAdmin).startAutoscaleDrill(30, 80))
				.rejects
				.toThrowError(ForbiddenError);

			await expect(service(nonAdmin).stopAutoscaleDrill())
				.rejects
				.toThrowError(ForbiddenError);

			await expect(service(nonAdmin).readAutoscaleDrill())
				.rejects
				.toThrowError(ForbiddenError);

			expect(startDrill).not.toHaveBeenCalled();
			expect(stopDrill).not.toHaveBeenCalled();
		});
	});
});
