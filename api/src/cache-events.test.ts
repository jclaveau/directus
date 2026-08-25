import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
	cacheStatsActive,
	cacheStatsConfigured,
	queueCacheDescriptor,
	clampCacheStatsWindow,
	claimCacheAnomalyThrottleSlot,
	queueCacheAnomaly,
	queueCachePurge,
	queueMissLatency,
	queueCacheHit,
	queueCacheMiss,
	enforceCacheStatsBudget,
	evictCacheEntriesForPath,
	evictCacheEntry,
	drainCacheEvents,
	effectiveTtlByBucket,
	flushCacheEventBuffer,
	getCacheStatsState,
	listCacheAnomalies,
	listCacheEntries,
	listPurgesCoveringEntry,
	readCacheDescriptorForRedisKey,
	readCacheTombstone,
	listCacheGroupLatencies,
	readCacheMissGap,
	reapCacheAnomalies,
	reapCacheDescriptors,
	reapCacheEvents,
	reapScopedCacheEntryTags,
	reapCachePurges,
	reapScopedCachePurgeTags,
	refreshCacheStatsFlag,
	setCacheStatsEnabled,
	subscribeCacheStatsToggle,
	truncateCacheEvents,
	writeCacheTombstone,
} from './cache-events.js';
import getDatabase from './database/index.js';
import { redisConfigAvailable, useRedis } from './redis/index.js';

const env: Record<string, any> = {
	CACHE_STATS_ENABLED: true,
	CACHE_NAMESPACE: 'scalabus',
	CACHE_STATS_MAX_BYTES: false,
	CACHE_STATS_MAX_BUFFER: false,
	CACHE_STATS_GAP_LOOKBACK: '1h',
};

vi.mock('@directus/env', () => ({ useEnv: () => env }));
vi.mock('./redis/index.js');
vi.mock('./database/index.js', () => ({ default: vi.fn() }));

// The dialect helper answers the Timescale probe. cache-events.ts imports it
// dynamically so the tree stays out of every consumer's module graph; mocking
// it here keeps it out of this one's too.
const mockHasTimescale = vi.hoisted(() => vi.fn(async () => true));

vi.mock('./database/helpers/index.js', () => {
	return { getHelpers: () => ({ schema: { hasTimescale: mockHasTimescale } }) };
});

// cache.js reaches this module through scoped-cache.js, so the descriptor reaper
// imports it dynamically; mocking it keeps that hop out of the unit's way.
const mockCache = vi.hoisted(() => ({ hasMany: vi.fn() }));
const mockGetCache = vi.hoisted(() => vi.fn(() => ({ cache: mockCache })));
vi.mock('./cache.js', () => ({ getCache: mockGetCache }));
const mockLogger = { warn: vi.fn(), info: vi.fn() };
vi.mock('./logger/index.js', () => ({ useLogger: () => mockLogger }));

const mockBus = { publish: vi.fn(), subscribe: vi.fn() };
vi.mock('./bus/index.js', () => ({ useBus: () => mockBus }));

const STREAM = 'scalabus:stats:events';

let streamBatch: [string, string[]][];

let mockRedis: {
	call: Mock;
	xlen: Mock;
	get: Mock;
	set: Mock;
	del: Mock;
	scan: Mock;
	unlink: Mock;
	pipeline: Mock;
};

let builder: any;
let queryRows: any[];
// Per-table override for the few reads that fire more than one query, keyed by
// the exact table expression. Falls back to `queryRows` so every other test is
// untouched.
let rowsByTable: Record<string, any[]>;
// `.first()` answers in call order: the descriptor lookup asks the primary
// key, then falls back to `redis_key`, and the two must be stageable apart.
let firstRows: any[];
let lastTable: string;
let pluckResult: string[];
let deleteCount: number;

let mockDb: any;

beforeEach(() => {
	streamBatch = [];
	queryRows = [];
	rowsByTable = {};
	firstRows = [];
	lastTable = '';
	pluckResult = [];
	deleteCount = 0;

	mockRedis = {
		// Stream ops go through .call(). XREADGROUP returns the staged batch under the
		// consumer-group envelope [[stream, entries]]; XAUTOCLAIM finds nothing pending.
		call: vi.fn(async (command: string) => {
			if (command === 'XREADGROUP') {
				return streamBatch.length > 0
					? [[STREAM, streamBatch]]
					: null;
			}

			if (command === 'XAUTOCLAIM') {
				return ['0-0', [], []];
			}

			return null;
		}),
		xlen: vi.fn(),
		get: vi.fn().mockResolvedValue(null),
		set: vi.fn(),
		del: vi.fn(),
		scan: vi.fn().mockResolvedValue(['0', []]),
		unlink: vi.fn(),
		pipeline: vi.fn(),
	};

	// Pipelined XADDs delegate to .call(); assertions see them after a flush.
	const pipeStub: any = {
		call: (...args: unknown[]) => {
			(mockRedis.call as any)(...args);
			return pipeStub;
		},
		exec: () => Promise.resolve([]),
	};

	mockRedis.pipeline.mockReturnValue(pipeStub);

	// Chainable knex stub: chain methods return the builder; terminals resolve the
	// staged result. Thenable so `await db(t).….select(…)` resolves queryRows.
	builder = {
		insert: vi.fn(() => builder),
		onConflict: vi.fn(() => builder),
		merge: vi.fn(() => Promise.resolve()),
		ignore: vi.fn(() => Promise.resolve()),
		truncate: vi.fn(() => Promise.resolve()),
		join: vi.fn(() => builder),
		leftJoin: vi.fn(() => builder),
		from: vi.fn(() => builder),
		// A grouped `where(callback)` runs its arm the way knex does; every other
		// form (column, operator, value) just chains.
		where: vi.fn((first: any) => {
			if (typeof first === 'function') {
				first(builder);
			}

			return builder;
		}),
		orWhere: vi.fn(() => builder),
		whereRaw: vi.fn(() => builder),
		// Run the sub-builder like knex does at compile time, so a semi-join's own
		// clauses land on the same spies the outer query's do.
		whereExists: vi.fn((callback: any) => {
			callback(builder);
			return builder;
		}),
		whereNotExists: vi.fn((callback: any) => {
			callback(builder);
			return builder;
		}),
		whereNull: vi.fn(() => builder),
		whereNotNull: vi.fn(() => builder),
		whereNotIn: vi.fn(() => builder),
		whereIn: vi.fn(() => builder),
		groupBy: vi.fn(() => builder),
		groupByRaw: vi.fn(() => builder),
		orderBy: vi.fn(() => builder),
		limit: vi.fn(() => builder),
		select: vi.fn(() => builder),
		distinct: vi.fn(() => builder),
		first: vi.fn(() => Promise.resolve(firstRows.shift())),
		pluck: vi.fn(() => Promise.resolve(pluckResult)),
		delete: vi.fn(() => Promise.resolve(deleteCount)),
		then: (resolve: any, reject: any) => {
			const rows = rowsByTable[lastTable] ?? queryRows;
			return Promise.resolve(rows).then(resolve, reject);
		},
	};

	mockDb = vi.fn((table: string) => {
		lastTable = table;
		return builder;
	});

	mockDb.batchInsert = vi.fn();
	mockDb.raw = vi.fn();
	mockDb.client = { config: { client: 'pg' } };
	// persistStreamBatch wraps its inserts in a transaction; run the callback with the
	// same mock so batchInsert/builder assertions still see the calls.
	mockDb.transaction = (cb: any) => cb(mockDb);

	env['CACHE_STATS_ENABLED'] = true;
	env['CACHE_STATS_MAX_BYTES'] = false;
	env['CACHE_STATS_MAX_BUFFER'] = false;

	vi.mocked(redisConfigAvailable).mockReturnValue(true);
	vi.mocked(useRedis).mockReturnValue(mockRedis as any);
	vi.mocked(getDatabase).mockReturnValue(mockDb);
});

afterEach(async () => {
	await flushCacheEventBuffer(); // drain any buffered captures so they can't leak forward
	vi.clearAllMocks();
});

// Prime the in-process flag to the given override, mirroring the schedule's poll.
async function armFlag(override: string | null = null) {
	mockRedis.get.mockResolvedValueOnce(override);
	await refreshCacheStatsFlag();
}

function streamEntry(
	id: string,
	fields: Record<string, string>,
): [string, string[]] {
	const flat: string[] = [];

	for (const [field, value] of Object.entries(fields)) {
		flat.push(field, value);
	}

	return [id, flat];
}

function fieldAfter(call: string[], name: string): string {
	return call[call.indexOf(name) + 1]!;
}

describe('cacheStatsConfigured', () => {
	it('is true with redis available and the master switch on', () => {
		expect(cacheStatsConfigured()).toBe(true);
	});

	it('is false when the master switch is off', () => {
		env['CACHE_STATS_ENABLED'] = false;
		expect(cacheStatsConfigured()).toBe(false);
	});

	it('is false when redis is unavailable', () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		expect(cacheStatsConfigured()).toBe(false);
	});
});

describe('refreshCacheStatsFlag', () => {
	it('activates when no override is set', async () => {
		await armFlag(null);
		expect(cacheStatsActive()).toBe(true);
	});

	it('stays off when the override is 0', async () => {
		await armFlag('0');
		expect(cacheStatsActive()).toBe(false);
	});

	it('deactivates when not configured, without reading redis', async () => {
		env['CACHE_STATS_ENABLED'] = false;
		await refreshCacheStatsFlag();
		expect(cacheStatsActive()).toBe(false);
		expect(mockRedis.get).not.toHaveBeenCalled();
	});
});

describe('queueCacheHit', () => {
	it('appends a hit keyed by the cache key', async () => {
		await armFlag(null);

		await queueCacheHit({
			cacheKey: 'k1',
			ageMs: 5000,
			ttlMs: 300000,
			durationMs: 12,
		});

		await flushCacheEventBuffer();
		const call = mockRedis.call.mock.calls[0]!;
		expect(call[0]).toBe('XADD');
		expect(call[1]).toBe(STREAM);
		expect(fieldAfter(call, 'kind')).toBe('h');
		expect(fieldAfter(call, 'cacheKey')).toBe('k1');
		expect(fieldAfter(call, 'ageMs')).toBe('5000');
		expect(fieldAfter(call, 'ttlMs')).toBe('300000');
		expect(fieldAfter(call, 'durationMs')).toBe('12');
	});

	it('serialises a null TTL as an empty string', async () => {
		await armFlag(null);

		await queueCacheHit({
			cacheKey: 'k1',
			ageMs: 1,
			ttlMs: null,
			durationMs: null,
		});

		await flushCacheEventBuffer();
		expect(fieldAfter(mockRedis.call.mock.calls[0]!, 'ttlMs')).toBe('');
	});

	it('does nothing when capture is disabled', async () => {
		await setCacheStatsEnabled(false);
		mockRedis.call.mockClear();

		await queueCacheHit({
			cacheKey: 'k1',
			ageMs: 1,
			ttlMs: null,
			durationMs: null,
		});

		expect(mockRedis.call).not.toHaveBeenCalled();
	});

	it('queues a fill-latency event tagged kind f', async () => {
		await armFlag(null);
		mockRedis.call.mockClear();

		queueMissLatency(42, 'fill', 'kf');
		await flushCacheEventBuffer();

		const call = mockRedis.call.mock.calls[0]!;
		expect(fieldAfter(call, 'kind')).toBe('f');
		expect(fieldAfter(call, 'cacheKey')).toBe('kf');
		expect(fieldAfter(call, 'durationMs')).toBe('42');
	});

	it('tags an anomaly-miss latency event kind x', async () => {
		await armFlag(null);
		mockRedis.call.mockClear();

		queueMissLatency(10, 'anomaly');
		await flushCacheEventBuffer();

		const call = mockRedis.call.mock.calls[0]!;
		expect(fieldAfter(call, 'kind')).toBe('x');
		expect(fieldAfter(call, 'durationMs')).toBe('10');
	});

	it('tags an other-miss latency event kind o', async () => {
		await armFlag(null);
		mockRedis.call.mockClear();

		queueMissLatency(20, 'other');
		await flushCacheEventBuffer();

		const call = mockRedis.call.mock.calls[0]!;
		expect(fieldAfter(call, 'kind')).toBe('o');
		expect(fieldAfter(call, 'durationMs')).toBe('20');
	});
});

describe('long redis keys (hash-identity, no length gate)', () => {
	const longRedisKey = 'x'.repeat(256);

	it('still tracks a hit — the stats key is the fixed-length hash', async () => {
		await armFlag(null);
		mockRedis.call.mockClear();

		await queueCacheHit({
			cacheKey: 'shorthash',
			ageMs: 1,
			ttlMs: null,
			durationMs: null,
		});

		await flushCacheEventBuffer();
		expect(mockRedis.call).toHaveBeenCalled();
	});

	it('carries the long redis key on the descriptor', async () => {
		await armFlag(null);
		mockRedis.call.mockClear();

		await queueCacheDescriptor({
			cacheKey: 'shorthash',
			redisKey: longRedisKey,
			method: 'GET',
			path: '/x',
			collection: null,
			userId: null,
			query: '{}',
			url: '/x',
			bytes: 0,
			fillMs: 0,
			scopedCacheTags: [],
		});

		await flushCacheEventBuffer();
		expect(fieldAfter(mockRedis.call.mock.calls[0]!, 'redisKey')).toBe(longRedisKey);
	});

	it('always writes the tombstone (keyed by the redis key)', async () => {
		await armFlag(null);
		mockRedis.set.mockClear();

		await writeCacheTombstone(longRedisKey, 9_999_999_999_999);

		expect(mockRedis.set).toHaveBeenCalled();
	});
});

describe('queueCacheMiss', () => {
	it('appends a miss with a real gap', async () => {
		await armFlag(null);

		await queueCacheMiss({ cacheKey: 'k1', gapMs: 2000, ttlMs: 300000 });

		await flushCacheEventBuffer();
		const call = mockRedis.call.mock.calls[0]!;
		expect(fieldAfter(call, 'kind')).toBe('m');
		expect(fieldAfter(call, 'cacheKey')).toBe('k1');
		expect(fieldAfter(call, 'gapMs')).toBe('2000');
	});

	it('serialises a cold miss (null gap) as an empty string', async () => {
		await armFlag(null);

		await queueCacheMiss({ cacheKey: 'k1', gapMs: null, ttlMs: null });

		await flushCacheEventBuffer();
		const call = mockRedis.call.mock.calls[0]!;
		expect(fieldAfter(call, 'gapMs')).toBe('');
		expect(fieldAfter(call, 'ttlMs')).toBe('');
	});
});

describe('clampCacheStatsWindow', () => {
	it('defaults to 24h when the request is missing or unparseable', () => {
		expect(clampCacheStatsWindow(undefined)).toBe(86_400_000);
		expect(clampCacheStatsWindow(Number.NaN)).toBe(86_400_000);
	});

	it('floors below 1m and caps at the 30d retention', () => {
		expect(clampCacheStatsWindow(30_000)).toBe(60_000);
		expect(clampCacheStatsWindow(999_999_999_999)).toBe(2_592_000_000);
	});

	it('passes an in-range window through', () => {
		expect(clampCacheStatsWindow(3_600_000)).toBe(3_600_000);
	});

	it('never returns below 1m even when retention is sub-minute', () => {
		env['CACHE_STATS_RETENTION'] = '30s';
		expect(clampCacheStatsWindow(3_600_000)).toBe(60_000);
		delete env['CACHE_STATS_RETENTION'];
	});
});

describe('claimCacheAnomalyThrottleSlot / queueCacheAnomaly', () => {
	it('emits an anomaly sample keyed by the cache key', async () => {
		await armFlag(null);

		queueCacheAnomaly({ cacheKey: 'k1', reason: 'missing_scope' });

		await flushCacheEventBuffer();
		const call = mockRedis.call.mock.calls[0]!;
		expect(call[0]).toBe('XADD');
		expect(fieldAfter(call, 'kind')).toBe('a');
		expect(fieldAfter(call, 'cacheKey')).toBe('k1');
		expect(fieldAfter(call, 'reason')).toBe('missing_scope');
	});

	it('claims with SET NX + expiry and returns true', async () => {
		await armFlag(null);
		mockRedis.set.mockResolvedValueOnce('OK');

		const claimed = await claimCacheAnomalyThrottleSlot('redis_error', 'k1');

		expect(claimed).toBe(true);
		const setCall = mockRedis.set.mock.calls[0]!;
		expect(setCall[0]).toBe('scalabus:stats:anom:redis_error:k1');
		expect(setCall).toContain('NX');
		expect(setCall).toContain('PX');
		expect(setCall[setCall.indexOf('PX') + 1]).toBe(60_000);
	});

	it('returns false when the slot is already claimed', async () => {
		await armFlag(null);
		mockRedis.set.mockResolvedValueOnce(null);

		const claimed = await claimCacheAnomalyThrottleSlot('missing_scope', 'k1');

		expect(claimed).toBe(false);
	});

	it('both no-op when capture is disabled', async () => {
		await setCacheStatsEnabled(false);
		mockRedis.set.mockClear();
		mockRedis.call.mockClear();

		const claimed = await claimCacheAnomalyThrottleSlot('value_too_large', 'k1');
		queueCacheAnomaly({ cacheKey: 'k1', reason: 'value_too_large' });

		expect(claimed).toBe(false);
		expect(mockRedis.set).not.toHaveBeenCalled();
		expect(mockRedis.call).not.toHaveBeenCalled();
	});
});

describe('queueCacheDescriptor', () => {
	it('appends the full descriptor keyed by the cache key', async () => {
		await armFlag(null);

		await queueCacheDescriptor({
			cacheKey: 'k1',
			redisKey: '/items/articles?limit=5:user-1',
			coarse: true,
			method: 'GET',
			path: '/items/articles',
			collection: 'articles',
			userId: 'user-1',
			query: '{"limit":5}',
			url: '/items/articles?limit=5',
			bytes: 42,
			fillMs: 240,
			scopedCacheTags: [],
		});

		await flushCacheEventBuffer();
		const call = mockRedis.call.mock.calls[0]!;
		expect(fieldAfter(call, 'kind')).toBe('d');
		expect(fieldAfter(call, 'cacheKey')).toBe('k1');
		expect(fieldAfter(call, 'redisKey')).toBe('/items/articles?limit=5:user-1');
		expect(fieldAfter(call, 'coarse')).toBe('1');
		expect(fieldAfter(call, 'path')).toBe('/items/articles');
		expect(fieldAfter(call, 'userId')).toBe('user-1');
		expect(fieldAfter(call, 'bytes')).toBe('42');
	});

	it('serialises a null collection and user as empty strings', async () => {
		await armFlag(null);

		await queueCacheDescriptor({
			cacheKey: 'k2',
			redisKey: '',
			coarse: false,
			method: 'GET',
			path: '/server/info',
			collection: null,
			userId: null,
			query: '{}',
			url: '',
			bytes: 0,
			fillMs: 0,
			scopedCacheTags: [],
		});

		await flushCacheEventBuffer();
		const call = mockRedis.call.mock.calls[0]!;
		expect(fieldAfter(call, 'collection')).toBe('');
		expect(fieldAfter(call, 'userId')).toBe('');
	});
});

describe('tombstone', () => {
	it('keeps only the lookback TTL once the entry has already expired', async () => {
		await armFlag(null);

		// expiredAt in the past → no remaining life, so PX is just the lookback.
		await writeCacheTombstone('k1', 301000);

		expect(mockRedis.set).toHaveBeenCalledWith(
			'scalabus:stats:tomb:k1',
			'301000',
			'PX',
			3600000,
		);
	});

	it('floors the tombstone PX at 1ms (never PX 0)', async () => {
		await armFlag(null);
		env['CACHE_STATS_GAP_LOOKBACK'] = '0';

		// Already expired + zero lookback → raw PX 0 (Redis rejects); floored to 1.
		await writeCacheTombstone('k1', 301000);

		expect(mockRedis.set).toHaveBeenCalledWith(
			'scalabus:stats:tomb:k1',
			'301000',
			'PX',
			1,
		);

		env['CACHE_STATS_GAP_LOOKBACK'] = '1h';
	});

	it('lives for the entry remaining life PLUS the lookback', async () => {
		await armFlag(null);

		const now = 1_000_000;
		// mockRestore below: clearAllMocks doesn't restore impls, so a frozen
		// Date.now would leak into later tests.
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
		const expiredAt = now + 600_000; // 10m of life left

		await writeCacheTombstone('k1', expiredAt);

		// 600_000 remaining life + 3_600_000 lookback → the tombstone outlives the
		// entry, so a post-expiry miss can still read the gap.
		expect(mockRedis.set).toHaveBeenCalledWith(
			'scalabus:stats:tomb:k1',
			String(expiredAt),
			'PX',
			4_200_000,
		);

		nowSpy.mockRestore();
	});

	it('does not write when capture is disabled', async () => {
		await setCacheStatsEnabled(false);
		mockRedis.set.mockClear();

		await writeCacheTombstone('k1', 301000);

		expect(mockRedis.set).not.toHaveBeenCalled();
	});

	it('measures the gap since expiry on a miss', async () => {
		mockRedis.get.mockResolvedValueOnce('300000');
		expect(await readCacheMissGap('k1', 305000)).toBe(5000);
	});

	it('returns null for a cold miss (no tombstone)', async () => {
		mockRedis.get.mockResolvedValueOnce(null);
		expect(await readCacheMissGap('k1', 305000)).toBe(null);
	});
});

describe('XADD batching', () => {
	it('buffers captures and flushes them in a single pipeline', async () => {
		await armFlag(null);

		await queueCacheHit({
			cacheKey: 'a',
			ageMs: 1,
			ttlMs: null,
			durationMs: null,
		});

		await queueCacheMiss({ cacheKey: 'b', gapMs: null, ttlMs: null });

		// Nothing reaches Redis until the flush.
		expect(mockRedis.pipeline).not.toHaveBeenCalled();

		await flushCacheEventBuffer();

		// One pipeline carrying both XADDs, in order.
		expect(mockRedis.pipeline).toHaveBeenCalledTimes(1);

		const kinds = mockRedis.call.mock.calls
			.filter((call) => call[0] === 'XADD')
			.map((call) => fieldAfter(call, 'kind'));

		expect(kinds).toEqual(['h', 'm']);
	});

	it('one XADD pipeline in flight at a time under a slow Redis', async () => {
		await armFlag(null);

		// A slow first exec, held open so its flush stays in flight.
		let releaseExec: () => void = () => {};

		let execCalls = 0;

		const slowPipe: any = {
			call: () => slowPipe,
			exec: () => {
				execCalls += 1;

				return execCalls === 1
					? new Promise<void>((resolve) => {
						releaseExec = () => resolve();
					})
					: Promise.resolve([]);
			},
		};

		mockRedis.pipeline.mockReturnValue(slowPipe);

		await queueCacheHit({
			cacheKey: 'a',
			ageMs: 1,
			ttlMs: null,
			durationMs: null,
		});

		const first = flushCacheEventBuffer(); // starts exec #1, awaits the gate (in flight)

		await queueCacheHit({
			cacheKey: 'b',
			ageMs: 1,
			ttlMs: null,
			durationMs: null,
		});

		await flushCacheEventBuffer(); // in-flight guard → NO second concurrent exec

		expect(execCalls).toBe(1);

		releaseExec(); // resolve exec #1 → finally chains a follow-up for the buffered 'b'
		await first;
		await new Promise((resolve) => setImmediate(resolve));
		await new Promise((resolve) => setImmediate(resolve));

		expect(execCalls).toBe(2);
	});

	it('force-flushes when the buffer hits its cap', async () => {
		await armFlag(null);

		for (let i = 0; i < 1000; i++) {
			await queueCacheMiss({ cacheKey: `k${i}`, gapMs: null, ttlMs: null });
		}

		expect(mockRedis.pipeline).toHaveBeenCalled();
	});
});

describe('drainCacheEvents', () => {
	it('demuxes hits/misses to events and descriptors to the dimension', async () => {
		streamBatch = [
			streamEntry('1-0', {
				kind: 'h', cacheKey: 'k1', ageMs: '5000', ttlMs: '300000',
				durationMs: '12', ts: '1000',
			}),
			streamEntry('2-0', {
				kind: 'm', cacheKey: 'k2', gapMs: '2000', ttlMs: '300000', ts: '2000',
			}),
			streamEntry('3-0', {
				kind: 'd', cacheKey: 'k1', redisKey: '/items/a:u1', coarse: '1',
				method: 'GET', path: '/items/a', collection: 'a', userId: 'u1',
				query: '{}', url: '/items/a', bytes: '42', fillMs: '240', ts: '3000',
			}),
		];

		const drained = await drainCacheEvents();

		expect(drained).toBe(3);

		expect(mockDb.batchInsert).toHaveBeenCalledWith(
			'directus_cache_events',
			[
				{
					time: new Date(1000),
					cache_key: 'k1',
					kind: 0,
					age_ms: 5000,
					gap_ms: null,
					ttl_ms: 300000,
					duration_ms: 12,
				},
				{
					time: new Date(2000),
					cache_key: 'k2',
					kind: 1,
					age_ms: null,
					gap_ms: 2000,
					ttl_ms: 300000,
					duration_ms: null,
				},
			],
			500,
		);

		expect(mockDb).toHaveBeenCalledWith('directus_cache_descriptors');

		expect(builder.insert).toHaveBeenCalledWith([
			{
				cache_key: 'k1',
				redis_key: '/items/a:u1',
				coarse: true,
				method: 'GET',
				path: '/items/a',
				collection: 'a',
				user_id: 'u1',
				query: '{}',
				bytes: 42,
				fill_ms: 240,
				last_filled: new Date(3000),
			},
		]);

		expect(builder.onConflict).toHaveBeenCalledWith('cache_key');
		expect(builder.merge).toHaveBeenCalled();
		expect(mockRedis.call).toHaveBeenCalledWith('XDEL', STREAM, '1-0', '2-0', '3-0');
	});

	it('routes anomaly locators to insert-if-absent, not merge', async () => {
		streamBatch = [
			streamEntry('1-0', {
				kind: 'd', cacheKey: 'k1', redisKey: 'rk1', coarse: '0',
				method: 'GET', path: '/items/a', collection: 'a', userId: '',
				query: '{}', url: '/items/a', bytes: '42', fillMs: '5', ts: '1000',
			}),
			streamEntry('2-0', {
				kind: 'd', cacheKey: 'k9', redisKey: 'rk9', coarse: '0',
				method: 'GET', path: '/server/info', collection: '', userId: '',
				query: '{}', url: '/server/info', bytes: '0', fillMs: '0',
				ts: '', // empty ts = a locator (never filled)
			}),
		];

		await drainCacheEvents();

		// Real k1 merges with a fill time; locator k9 ignores with last_filled null.
		expect(builder.insert).toHaveBeenCalledWith([
			expect.objectContaining({
				cache_key: 'k1', bytes: 42, last_filled: new Date(1000),
			}),
		]);

		expect(builder.insert).toHaveBeenCalledWith([
			expect.objectContaining({ cache_key: 'k9', bytes: 0, last_filled: null }),
		]);

		expect(builder.merge).toHaveBeenCalledTimes(1);
		expect(builder.ignore).toHaveBeenCalledTimes(1);
	});

	it('applies a real fill before a same-key locator in one batch', async () => {
		streamBatch = [
			streamEntry('1-0', {
				kind: 'd', cacheKey: 'kx', redisKey: 'rk', coarse: '0', method: 'GET',
				path: '/p', collection: '', userId: '', query: '{}', url: '/p',
				bytes: '42', fillMs: '5', ts: '1000',
			}),
			streamEntry('2-0', {
				kind: 'd', cacheKey: 'kx', redisKey: 'rk', coarse: '0', method: 'GET',
				path: '/p', collection: '', userId: '', query: '{}', url: '/p',
				bytes: '0', fillMs: '0', ts: '', // same key, locator (never filled)
			}),
		];

		const order: string[] = [];

		builder.merge.mockImplementation(() => {
			order.push('merge');
			return Promise.resolve();
		});

		builder.ignore.mockImplementation(() => {
			order.push('ignore');
			return Promise.resolve();
		});

		await drainCacheEvents();

		expect(builder.insert).toHaveBeenCalledWith([
			expect.objectContaining({
				cache_key: 'kx',
				bytes: 42,
				last_filled: new Date(1000),
			}),
		]);

		expect(builder.insert).toHaveBeenCalledWith([
			expect.objectContaining({ cache_key: 'kx', bytes: 0, last_filled: null }),
		]);

		// Real merge must run BEFORE the locator ignore, so a 0-byte locator can't
		// clobber a same-key fill's bytes/coarse.
		expect(order).toEqual(['merge', 'ignore']);
	});

	it('inserts anomaly entries into the anomalies table', async () => {
		streamBatch = [
			streamEntry('1-0', {
				kind: 'a', cacheKey: 'k9', reason: 'value_too_large',
				detail: '2048B', ts: '4000',
			}),
		];

		const drained = await drainCacheEvents();

		expect(drained).toBe(1);

		expect(mockDb.batchInsert).toHaveBeenCalledWith(
			'directus_cache_anomalies',
			[
				{
					time: new Date(4000),
					cache_key: 'k9',
					reason: 'value_too_large',
					detail: '2048B',
				},
			],
			500,
		);
	});

	it('demuxes purges to their own table, unknown size and all', async () => {
		streamBatch = [
			streamEntry('1-0', {
				kind: 'p',
				collection: 'articles',
				mode: 'collection',
				purgeId: 'p-1',
				scopedCacheTags: 'articles,articles:author=2',
				scopedCacheTagCount: '4',
				evicted: '11',
				durationMs: '7',
				ts: '6000',
			}),
			// A namespace clear: no collection, and a size that was never knowable.
			// The empty field must arrive as null rather than 0 — on the chart the
			// two say different things.
			streamEntry('2-0', {
				kind: 'p',
				collection: '',
				mode: 'namespace',
				purgeId: 'p-2',
				scopedCacheTags: '',
				scopedCacheTagCount: '0',
				evicted: '',
				durationMs: '3',
				ts: '7000',
			}),
		];

		await drainCacheEvents();

		expect(mockDb.batchInsert).toHaveBeenCalledWith(
			'directus_cache_purges',
			[
				{
					time: new Date(6000),
					purge_id: 'p-1',
					collection: 'articles',
					mode: 'collection',
					scoped_cache_tag_count: 4,
					evicted: 11,
					duration_ms: 7,
				},
				{
					time: new Date(7000),
					purge_id: 'p-2',
					collection: null,
					mode: 'namespace',
					scoped_cache_tag_count: 0,
					evicted: null,
					duration_ms: 3,
				},
			],
			expect.any(Number),
		);

		// Each tag becomes its own row, carrying the purge's id so an entry covered
		// by two of them still counts the purge once.
		expect(mockDb.batchInsert).toHaveBeenCalledWith(
			'directus_scoped_cache_purge_tags',
			[
				{
					purge_id: 'p-1',
					time: new Date(6000),
					scoped_cache_tag: 'articles',
					collection: 'articles',
				},
				{
					purge_id: 'p-1',
					time: new Date(6000),
					scoped_cache_tag: 'articles:author=2',
					collection: 'articles',
				},
				// The purge was a `collection` one, so it also lands as a
				// collection-wide row that pinned entries can be attributed by.
				{
					purge_id: 'p-1',
					time: new Date(6000),
					scoped_cache_tag: '',
					collection: 'articles',
				},
			],
			expect.any(Number),
		);

		// And none of it leaked into the hit/miss fact table beside it.
		expect(mockDb.batchInsert).not.toHaveBeenCalledWith(
			'directus_cache_events',
			expect.anything(),
			expect.anything(),
		);
	});

	// A coarse purge drops the bare collection tag AND every slice of it, so it
	// covers pinned entries too — and a pinned read carries only its slice tag
	// (`articles:owner=7`), never the bare one. Recording the bare tag alone
	// would attribute the purge to global reads and miss every pinned entry,
	// which is most of what it destroys. So it records the COLLECTION.
	it('records a coarse purge as covering its whole collection', async () => {
		streamBatch = [
			streamEntry('1-0', {
				kind: 'p',
				purgeId: 'p-coarse',
				collection: 'articles',
				mode: 'collection',
				scopedCacheTags: '',
				scopedCacheTagCount: '9',
				evicted: '30',
				ts: '6000',
			}),
		];

		await drainCacheEvents();

		// One row, not one per slice the scan turned up: the reach is the
		// collection, and enumerating derived slices is the unbounded fan-out this
		// table exists to avoid.
		expect(mockDb.batchInsert).toHaveBeenCalledWith(
			'directus_scoped_cache_purge_tags',
			[
				{
					purge_id: 'p-coarse',
					time: new Date(6000),
					scoped_cache_tag: '',
					collection: 'articles',
				},
			],
			expect.any(Number),
		);
	});

	it('carries each entry tag\'s own collection, for the coarse join', async () => {
		streamBatch = [
			streamEntry('1-0', {
				kind: 'd', cacheKey: 'k1', redisKey: 'r1', coarse: '0', method: 'GET',
				path: '/items/a', collection: 'articles', userId: '', query: '{}',
				url: '/items/a', bytes: '42', fillMs: '5',
				// A read spanning two collections carries a tag from each, so the
				// collection comes off the TAG rather than off the descriptor.
				scopedCacheTags: 'articles:owner=7,directus_users', ts: '1000',
			}),
		];

		await drainCacheEvents();

		expect(mockDb.batchInsert).toHaveBeenCalledWith(
			'directus_scoped_cache_entry_tags',
			[
				{
					cache_key: 'k1',
					scoped_cache_tag: 'articles:owner=7',
					collection: 'articles',
				},
				{
					cache_key: 'k1',
					scoped_cache_tag: 'directus_users',
					collection: 'directus_users',
				},
			],
			expect.any(Number),
		);
	});

	it('replaces an entry\'s tags on refill rather than merging them', async () => {
		streamBatch = [
			streamEntry('1-0', {
				kind: 'd', cacheKey: 'k1', redisKey: 'r1', coarse: '0', method: 'GET',
				path: '/items/a', collection: 'a', userId: '', query: '{}',
				url: '/items/a', bytes: '42', fillMs: '5',
				// The same tag twice: a read can resolve one slice through two paths.
				scopedCacheTags: 'a,a:owner=7,a', ts: '1000',
			}),
		];

		await drainCacheEvents();

		// Deleted first, so a refill under a narrower scope cannot leave an old tag
		// behind claiming coverage the entry no longer has.
		expect(builder.whereIn).toHaveBeenCalledWith('cache_key', ['k1']);
		expect(builder.delete).toHaveBeenCalled();

		expect(mockDb.batchInsert).toHaveBeenCalledWith(
			'directus_scoped_cache_entry_tags',
			[
				{ cache_key: 'k1', scoped_cache_tag: 'a', collection: 'a' },
				{ cache_key: 'k1', scoped_cache_tag: 'a:owner=7', collection: 'a' },
			],
			expect.any(Number),
		);
	});

	it('records no tags for a locator, which never resolved any', async () => {
		streamBatch = [
			streamEntry('1-0', {
				kind: 'd', cacheKey: 'k9', redisKey: 'r9', coarse: '0', method: 'GET',
				path: '/items/a', collection: 'a', userId: '', query: '{}',
				url: '/items/a', bytes: '0', fillMs: '0', tags: '',
				ts: '', // empty ts = a locator, written at an anomaly site
			}),
		];

		await drainCacheEvents();

		expect(mockDb.batchInsert).not.toHaveBeenCalledWith(
			'directus_scoped_cache_entry_tags',
			expect.anything(),
			expect.anything(),
		);
	});

	it('demuxes anomaly-miss (x→3) and other-miss (o→4) latency events', async () => {
		streamBatch = [
			streamEntry('1-0', {
				kind: 'x', cacheKey: '', durationMs: '10', ts: '6000',
			}),
			streamEntry('2-0', {
				kind: 'o', cacheKey: '', durationMs: '20', ts: '7000',
			}),
		];

		await drainCacheEvents();

		expect(mockDb.batchInsert).toHaveBeenCalledWith(
			'directus_cache_events',
			[
				{
					time: new Date(6000),
					cache_key: '',
					kind: 3,
					age_ms: null,
					gap_ms: null,
					ttl_ms: null,
					duration_ms: 10,
				},
				{
					time: new Date(7000),
					cache_key: '',
					kind: 4,
					age_ms: null,
					gap_ms: null,
					ttl_ms: null,
					duration_ms: 20,
				},
			],
			500,
		);
	});

	it('demuxes a fill-latency event to kind 2 with its duration', async () => {
		streamBatch = [
			streamEntry('1-0', {
				kind: 'f', cacheKey: 'kf', durationMs: '42', ts: '5000',
			}),
		];

		await drainCacheEvents();

		expect(mockDb.batchInsert).toHaveBeenCalledWith(
			'directus_cache_events',
			[
				{
					time: new Date(5000),
					cache_key: 'kf',
					kind: 2,
					age_ms: null,
					gap_ms: null,
					ttl_ms: null,
					duration_ms: 42,
				},
			],
			500,
		);
	});

	it('returns 0 without draining when not configured', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);

		expect(await drainCacheEvents()).toBe(0);
		expect(mockRedis.call).not.toHaveBeenCalled();
	});

	it('keeps draining until a batch is smaller than the page size', async () => {
		const fullBatch: [string, string[]][] = Array.from({ length: 500 }, (_, i) => {
			return streamEntry(`${i}-0`, {
				kind: 'h',
				cacheKey: 'k',
				ageMs: '1',
				ttlMs: '1',
				ts: '1',
			});
		});

		let call = 0;

		mockRedis.call.mockImplementation(async (command: string) => {
			if (command === 'XREADGROUP') {
				call += 1;
				return call === 1
					? [[STREAM, fullBatch]]
					: null;
			}

			if (command === 'XAUTOCLAIM') {
				return ['0-0', [], []];
			}

			return null;
		});

		expect(await drainCacheEvents()).toBe(500);
		expect(mockDb.batchInsert).toHaveBeenCalledTimes(1);
	});

	it('stores a null collection and user on the descriptor', async () => {
		streamBatch = [
			streamEntry('1-0', {
				kind: 'd',
				cacheKey: 'k1',
				method: 'GET',
				path: '/x',
				collection: '',
				userId: '',
				query: '{}',
				url: '',
				bytes: '0',
				ts: '1',
			}),
		];

		await drainCacheEvents();

		expect(builder.insert).toHaveBeenCalledWith([
			expect.objectContaining({ collection: null, user_id: null }),
		]);
	});

	it('yields the flush while the pool has queued acquirers', async () => {
		mockDb.client = {
			config: { client: 'pg' },
			pool: { numPendingAcquires: () => 3 },
		};

		streamBatch = [
			streamEntry('1-0', { kind: 'h', cacheKey: 'k', ageMs: '1', ts: '1' }),
		];

		// Saturated pool → skip this tick, leave the batch buffered (no DB/read).
		expect(await drainCacheEvents()).toBe(0);
		expect(mockRedis.call).not.toHaveBeenCalled();
		expect(mockDb.batchInsert).not.toHaveBeenCalled();
	});

	it('drops a poison batch instead of wedging on a failed insert', async () => {
		mockDb.batchInsert.mockRejectedValueOnce(new Error('value too long'));

		streamBatch = [
			streamEntry('1-0', {
				kind: 'h',
				cacheKey: 'k',
				ageMs: '1',
				ttlMs: '1',
				ts: '1',
			}),
		];

		// A deterministically-unpersistable batch must not reject the flush...
		await expect(drainCacheEvents()).resolves.toBe(1);

		// ...and it's still XDEL'd, so it can't be re-read from the stream head every
		// subsequent tick (the wedge this guards against).
		expect(mockDb.batchInsert).toHaveBeenCalledTimes(1);
		expect(mockRedis.call).toHaveBeenCalledWith('XDEL', STREAM, '1-0');
	});

	it('is single-flight: an overlapping call no-ops during a drain', async () => {
		await armFlag(null);

		let releaseRead: () => void = () => {};

		let readCalls = 0;

		const gate = new Promise<void>((resolve) => {
			releaseRead = resolve;
		});

		mockRedis.call.mockImplementation(async (command: string) => {
			if (command === 'XAUTOCLAIM') {
				return ['0-0', [], []];
			}

			if (command === 'XREADGROUP') {
				readCalls += 1;
				await gate; // hold the first drain open so the second call overlaps it
				return null;
			}

			return null;
		});

		const first = drainCacheEvents();
		const second = await drainCacheEvents();

		// The second call saw the latch and bailed without touching the stream.
		expect(second).toBe(0);

		releaseRead();
		await first;

		expect(readCalls).toBe(1);
	});

	it('reads via the consumer group, then acks + deletes entries', async () => {
		streamBatch = [
			streamEntry('1-0', { kind: 'h', cacheKey: 'k', ts: '1' }),
		];

		await drainCacheEvents();

		expect(mockRedis.call).toHaveBeenCalledWith(
			'XGROUP',
			'CREATE',
			STREAM,
			'drain',
			'0',
			'MKSTREAM',
		);

		// '>' hands out only never-delivered entries, so a peer node's drain can't
		// read this same batch — the double-insert a raw XRANGE would allow.
		expect(mockRedis.call).toHaveBeenCalledWith(
			'XREADGROUP',
			'GROUP',
			'drain',
			expect.any(String),
			'COUNT',
			'500',
			'STREAMS',
			STREAM,
			'>',
		);

		expect(mockRedis.call).toHaveBeenCalledWith('XACK', STREAM, 'drain', '1-0');
		expect(mockRedis.call).toHaveBeenCalledWith('XDEL', STREAM, '1-0');
	});

	it('tolerates an already-created consumer group (BUSYGROUP)', async () => {
		mockRedis.call.mockImplementation(async (command: string) => {
			if (command === 'XGROUP') {
				throw new Error('BUSYGROUP Consumer Group name already exists');
			}

			if (command === 'XAUTOCLAIM') {
				return ['0-0', [], []];
			}

			return null;
		});

		await expect(drainCacheEvents()).resolves.toBe(0);
	});

	it('reclaims stale pending entries and re-drives them', async () => {
		const pending = streamEntry('7-0', {
			kind: 'h', cacheKey: 'kp', ageMs: '9', ttlMs: '1', ts: '9',
		});

		mockRedis.call.mockImplementation(async (command: string) => {
			if (command === 'XAUTOCLAIM') {
				return ['0-0', [pending], []];
			}

			return null; // XGROUP ok, no never-delivered entries
		});

		expect(await drainCacheEvents()).toBe(1);

		expect(mockDb.batchInsert).toHaveBeenCalledWith(
			'directus_cache_events',
			[expect.objectContaining({ cache_key: 'kp' })],
			500,
		);

		expect(mockRedis.call).toHaveBeenCalledWith('XACK', STREAM, 'drain', '7-0');
	});
});

describe('enforceCacheStatsBudget', () => {
	const HOUR = 3_600_000;

	// Answer each of the ring's queries by what it asks for rather than by call
	// order: the timescale probe is cached for the module's life, so an order the
	// first test in the file sets would decide every later one.
	function scriptRing(
		sizes: number[],
		oldestChunks: any[][],
		hasTimescale = true,
	) {
		const measured = [...sizes];
		const chunks = [...oldestChunks];
		mockHasTimescale.mockResolvedValue(hasTimescale);

		mockDb.raw.mockImplementation(async (sql: string) => {
			if (sql.includes('unnest')) {
				return { rows: [{ bytes: measured.shift() ?? 0 }] };
			}

			if (sql.includes('timescaledb_information.chunks')) {
				return { rows: chunks.shift() ?? [] };
			}

			return { rows: [] };
		});
	}

	function oldestChunk(fact: string, ageMs: number) {
		return [{
			hypertable_name: fact,
			range_end: new Date(Date.now() - ageMs),
		}];
	}

	function droppedChunks() {
		return mockDb.raw.mock.calls
			.filter(([sql]: [string]) => sql.includes('drop_chunks'));
	}

	it('drops the oldest chunk when the subsystem is over budget', async () => {
		await armFlag(null);
		env['CACHE_STATS_MAX_BYTES'] = '1kb';
		const rangeEnd = new Date(Date.now() - 48 * HOUR);

		scriptRing(
			[5000, 100],
			[[{ hypertable_name: 'directus_cache_purges', range_end: rangeEnd }]],
		);

		await enforceCacheStatsBudget();

		expect(droppedChunks()).toHaveLength(1);

		expect(mockDb.raw).toHaveBeenCalledWith(
			expect.stringContaining('drop_chunks'),
			['directus_cache_purges', rangeEnd],
		);
	});

	it('never disables capture to stay inside the byte budget', async () => {
		await armFlag(null);
		env['CACHE_STATS_MAX_BYTES'] = '1kb';
		scriptRing([5000, 100], [oldestChunk('directus_cache_events', 48 * HOUR)]);

		await enforceCacheStatsBudget();

		// The whole point of the ring: the history shortens, the capture does not
		// stop, and no admin has to come back and turn it on again.
		expect(cacheStatsActive()).toBe(true);
		expect(mockRedis.set).not.toHaveBeenCalledWith('scalabus:stats:enabled', '0');

		expect(mockRedis.set).not.toHaveBeenCalledWith(
			'scalabus:stats:budget_alert',
			expect.anything(),
		);
	});

	it('evicts while capture is off — the bytes are there either way', async () => {
		await setCacheStatsEnabled(false);
		env['CACHE_STATS_MAX_BYTES'] = '1kb';
		scriptRing([5000, 100], [oldestChunk('directus_cache_events', 48 * HOUR)]);

		await enforceCacheStatsBudget();

		expect(droppedChunks()).toHaveLength(1);
	});

	it('evicts down to the low watermark, not back to the line', async () => {
		await armFlag(null);
		env['CACHE_STATS_MAX_BYTES'] = '1kb';

		// 1000 is already under the 1024 budget and still over the 921 watermark:
		// stopping at the line would leave the next tick cutting another chunk.
		scriptRing([5000, 1000, 900], [
			oldestChunk('directus_cache_events', 48 * HOUR),
			oldestChunk('directus_cache_events', 47 * HOUR),
		]);

		await enforceCacheStatsBudget();

		expect(droppedChunks()).toHaveLength(2);
	});

	it('keeps telemetry newer than the retention floor', async () => {
		await armFlag(null);
		env['CACHE_STATS_MAX_BYTES'] = '1kb';

		// No chunk old enough to drop: over budget is not a licence to delete the
		// hour that would explain the burst which filled it.
		scriptRing([5000], [[]]);

		await enforceCacheStatsBudget();

		expect(droppedChunks()).toHaveLength(0);
		expect(cacheStatsActive()).toBe(true);

		const [, bindings] = mockDb.raw.mock.calls.find(
			([sql]: [string]) => sql.includes('timescaledb_information.chunks'),
		)!;

		expect(Date.now() - (bindings[1] as Date).getTime())
			.toBeGreaterThanOrEqual(6 * HOUR);

		expect(Date.now() - (bindings[1] as Date).getTime())
			.toBeLessThan(6 * HOUR + 1000);
	});

	it('bounds how many chunks one tick may drop', async () => {
		await armFlag(null);
		env['CACHE_STATS_MAX_BYTES'] = '1kb';

		// Never comes back under: a budget lowered far below what the tables hold
		// walks down over several ticks instead of dropping everything at once.
		scriptRing(
			Array.from({ length: 20 }, () => 5000),
			Array.from(
				{ length: 20 },
				() => oldestChunk('directus_cache_events', 48 * HOUR),
			),
		);

		await enforceCacheStatsBudget();

		expect(droppedChunks()).toHaveLength(8);
	});

	it('measures every table of the subsystem, not just the events fact', async () => {
		await armFlag(null);
		env['CACHE_STATS_MAX_BYTES'] = '1kb';
		scriptRing([100], []);

		await enforceCacheStatsBudget();

		const [sql, bindings] = mockDb.raw.mock.calls.find(
			([statement]: [string]) => statement.includes('unnest'),
		)!;

		// The budget used to name directus_cache_events alone, which on the
		// database this was measured against was under a tenth of the footprint.
		expect(bindings[0]).toEqual([
			'directus_cache_events',
			'directus_cache_purges',
			'directus_scoped_cache_purge_tags',
			'directus_cache_descriptors',
			'directus_scoped_cache_entry_tags',
			'directus_cache_anomalies',
			'directus_cache_config_events',
		]);

		// A chunked fact keeps its rows in chunks the parent knows nothing about,
		// so only hypertable_size() sees them; the plain tables need the other.
		expect(sql).toContain('hypertable_size');
		expect(sql).toContain('pg_total_relation_size');
	});

	it('measures by relation size alone on plain postgres', async () => {
		// isTimescale caches for the module's life, so only a fresh import can
		// reach the branch a Timescale-shaped test above already decided.
		vi.resetModules();
		const fresh = await import('./cache-events.js');

		mockRedis.get.mockResolvedValueOnce(null);
		await fresh.refreshCacheStatsFlag();

		env['CACHE_STATS_MAX_BYTES'] = '1kb';
		scriptRing([100], [], false);

		await fresh.enforceCacheStatsBudget();

		const [sql] = mockDb.raw.mock.calls.find(
			([statement]: [string]) => statement.includes('unnest'),
		)!;

		expect(sql).not.toContain('hypertable_size');
	});

	it('does not measure at all when no byte budget is set', async () => {
		await armFlag(null);
		env['CACHE_STATS_MAX_BYTES'] = false;
		scriptRing([100], []);

		await enforceCacheStatsBudget();

		expect(mockDb.raw).not.toHaveBeenCalled();
	});

	it('skips the ring on a non-postgres client', async () => {
		await armFlag(null);
		env['CACHE_STATS_MAX_BYTES'] = '1kb';
		mockDb.client = { config: { client: 'sqlite3' } };

		await enforceCacheStatsBudget();

		expect(mockDb.raw).not.toHaveBeenCalled();
	});

	it('evicts nothing when the size probe rejects', async () => {
		// An unmeasurable subsystem must not read as an empty one: dropping chunks
		// on a size of zero would cut history to answer a number nobody has.
		mockDb.raw.mockRejectedValue(new Error('boom'));
		await armFlag(null);
		env['CACHE_STATS_MAX_BYTES'] = '1kb';

		await expect(enforceCacheStatsBudget()).resolves.toBeUndefined();
		expect(droppedChunks()).toHaveLength(0);
	});

	it('raises an alert when the floor leaves nothing to evict', async () => {
		await armFlag(null);
		env['CACHE_STATS_MAX_BYTES'] = '1kb';
		scriptRing([5000], [[]]);

		await enforceCacheStatsBudget();

		// Said, not acted on: capture keeps running and the admin page carries the
		// number, because there is no honest eviction left to make.
		expect(cacheStatsActive()).toBe(true);

		expect(mockRedis.set).toHaveBeenCalledWith(
			'scalabus:stats:budget_alert',
			expect.stringContaining('5000B over the 1024B budget'),
		);
	});

	it('clears the alert once it is back inside the budget', async () => {
		await armFlag(null);
		env['CACHE_STATS_MAX_BYTES'] = '1kb';
		scriptRing([100], []);

		await enforceCacheStatsBudget();

		expect(mockRedis.del).toHaveBeenCalledWith('scalabus:stats:budget_alert');
	});

	it('never touches the stream length', async () => {
		await armFlag(null);
		env['CACHE_STATS_MAX_BUFFER'] = 10;
		env['CACHE_STATS_MAX_BYTES'] = false;
		mockRedis.xlen.mockClear();

		await enforceCacheStatsBudget();

		// The stream is ringed by its own MAXLEN at write time; measuring it here
		// only ever served the autokill that used to read it.
		expect(mockRedis.xlen).not.toHaveBeenCalled();
	});
});

describe('setCacheStatsEnabled', () => {
	it('enabling flips the flag on', async () => {
		await setCacheStatsEnabled(true);

		expect(mockRedis.set).toHaveBeenCalledWith('scalabus:stats:enabled', '1');
		expect(cacheStatsActive()).toBe(true);
	});

	it('publishes the toggle on the bus so other nodes flip at once', async () => {
		await setCacheStatsEnabled(true);

		expect(mockBus.publish).toHaveBeenCalledWith('cacheStatsToggled', {
			enabled: true,
		});

		await setCacheStatsEnabled(false);

		expect(mockBus.publish).toHaveBeenCalledWith('cacheStatsToggled', {
			enabled: false,
		});
	});
});

describe('subscribeCacheStatsToggle', () => {
	it('re-reads the flag when a toggle lands on the bus', async () => {
		subscribeCacheStatsToggle();

		expect(mockBus.subscribe).toHaveBeenCalledWith(
			'cacheStatsToggled',
			expect.any(Function),
		);

		// The handler re-reads the durable key (enable → active).
		mockRedis.get.mockResolvedValueOnce('1');
		const handler = mockBus.subscribe.mock.calls[0]![1];
		await handler({ enabled: true });
		expect(cacheStatsActive()).toBe(true);
	});

	it('does not subscribe without redis', () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		subscribeCacheStatsToggle();
		expect(mockBus.subscribe).not.toHaveBeenCalled();
	});
});

describe('getCacheStatsState', () => {
	it('reports the budget alert and buffer length when configured', async () => {
		mockRedis.get.mockResolvedValue('5000B over the 1024B budget');
		mockRedis.xlen.mockResolvedValue(7);

		await expect(getCacheStatsState()).resolves.toMatchObject({
			configured: true,
			budgetAlert: '5000B over the 1024B budget',
			bufferLength: 7,
		});
	});

	it('reports nothing when not configured', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);

		await expect(getCacheStatsState()).resolves.toEqual({
			configured: false,
			enabled: false,
			budgetAlert: null,
			bufferLength: 0,
			droppedEvents: 0,
		});
	});
});

describe('truncateCacheEvents', () => {
	it('truncates every telemetry table, purges included', async () => {
		await truncateCacheEvents();

		expect(mockDb).toHaveBeenCalledWith('directus_cache_events');
		expect(mockDb).toHaveBeenCalledWith('directus_cache_descriptors');
		expect(mockDb).toHaveBeenCalledWith('directus_cache_anomalies');

		// Left behind, purges would count against entries whose own history was
		// just cleared — purges without hits, on a window reporting no traffic.
		expect(mockDb).toHaveBeenCalledWith('directus_cache_purges');
		expect(mockDb).toHaveBeenCalledWith('directus_scoped_cache_purge_tags');
		expect(mockDb).toHaveBeenCalledWith('directus_scoped_cache_entry_tags');
		expect(builder.truncate).toHaveBeenCalledTimes(6);
	});

	it('also clears the stream buffer and the throttle/tombstone keys', async () => {
		mockRedis.scan.mockImplementation((
			_cursor: string,
			_match: string,
			pattern: string,
		) => {
			// A held anomaly-throttle slot would otherwise suppress the next sample for
			// its whole window, so a truncate + re-provoke sees an empty table.
			return Promise.resolve([
				'0',
				pattern.includes(':anom:')
					? ['scalabus:stats:anom:missing_scope:h1']
					: [],
			]);
		});

		await truncateCacheEvents();

		expect(mockRedis.del).toHaveBeenCalledWith('scalabus:stats:events');

		expect(mockRedis.scan).toHaveBeenCalledWith(
			'0',
			'MATCH',
			'scalabus:stats:anom:*',
			'COUNT',
			100,
		);

		expect(mockRedis.scan).toHaveBeenCalledWith(
			'0',
			'MATCH',
			'scalabus:stats:tomb:*',
			'COUNT',
			100,
		);

		expect(mockRedis.unlink).toHaveBeenCalledWith(
			'scalabus:stats:anom:missing_scope:h1',
		);
	});

	it('skips the Redis reset when Redis is not configured', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		mockRedis.del.mockClear();

		await truncateCacheEvents();

		// The SQL side still clears in full; only the Redis reset is skipped.
		expect(builder.truncate).toHaveBeenCalledTimes(6);
		expect(mockRedis.del).not.toHaveBeenCalled();
	});
});

describe('capture is gated by the runtime flag', () => {
	it('queueCacheMiss does nothing when disabled', async () => {
		await setCacheStatsEnabled(false);
		mockRedis.call.mockClear();

		await queueCacheMiss({ cacheKey: 'k1', gapMs: null, ttlMs: null });

		expect(mockRedis.call).not.toHaveBeenCalled();
	});

	it('queueCacheDescriptor does nothing when disabled', async () => {
		await setCacheStatsEnabled(false);
		mockRedis.call.mockClear();

		await queueCacheDescriptor({
			cacheKey: 'k1',
			redisKey: '',
			coarse: false,
			method: 'GET',
			path: '/x',
			collection: null,
			userId: null,
			query: '{}',
			url: '',
			bytes: 0,
			fillMs: 0,
			scopedCacheTags: [],
		});

		expect(mockRedis.call).not.toHaveBeenCalled();
	});
});

describe('listCacheEntries', () => {
	// The number this whole feature exists for: purges beside hits, per request.
	it('counts the purges that covered each entry, deduped by purge', async () => {
		queryRows = [
			{
				cache_key: 'k1',
				redis_key: 'r1',
				coarse: false,
				method: 'GET',
				path: '/items/a',
				collection: 'a',
				user_id: null,
				user_email: null,
				query: '{}',
				url: '/items/a',
				bytes: '10',
				last_filled: new Date(500).toISOString(),
				hits: '2',
				misses: '0',
				fills: '1',
				last_hit_at: null,
				ttl_ms: null,
				fill_ms: null,
				hit_ms: null,
				recommended_ttl_ms: null,
			},
			{
				cache_key: 'k2',
				redis_key: 'r2',
				coarse: false,
				method: 'GET',
				path: '/items/b',
				collection: 'b',
				user_id: null,
				user_email: null,
				query: '{}',
				url: '/items/b',
				bytes: '10',
				last_filled: new Date(500).toISOString(),
				hits: '9',
				misses: '0',
				fills: '1',
				last_hit_at: null,
				ttl_ms: null,
				fill_ms: null,
				hit_ms: null,
				recommended_ttl_ms: null,
			},
		];

		// k1 was covered three times; k2 has no row at all, which must read as 0
		// rather than as missing.
		rowsByTable['directus_scoped_cache_entry_tags as et'] = [
			{ cache_key: 'k1', purges: '3' },
		];

		const entries = await listCacheEntries();

		expect(mockDb).toHaveBeenCalledWith('directus_scoped_cache_entry_tags as et');

		// COUNT(DISTINCT purge_id), so a purge covering two of an entry's tags is
		// one purge and not two.
		expect(mockDb.raw).toHaveBeenCalledWith(
			expect.stringContaining('COUNT(DISTINCT pt.purge_id)'),
		);

		expect(entries.map((entry) => [entry.key, entry.purges, entry.hits]))
			.toEqual([
				['k1', 3, 2],
				['k2', 0, 9],
			]);
	});

	// The symptom this whole fix exists for: an endpoint destroyed only by
	// collection-wide fallbacks read 0, because a coarse purge writes no tag row
	// to equi-join against. It is the expensive mode, so reading zero for it
	// inverts the very ranking the column was added to provide.
	it('counts a coarse purge against every entry of that collection', async () => {
		queryRows = [
			{
				cache_key: 'pinned',
				redis_key: 'r1',
				coarse: false,
				method: 'GET',
				path: '/items/articles',
				collection: 'articles',
				user_id: null,
				user_email: null,
				query: '{}',
				url: '/items/articles',
				bytes: '10',
				last_filled: new Date(500).toISOString(),
				hits: '1',
				misses: '0',
				fills: '1',
				last_hit_at: null,
				ttl_ms: null,
				fill_ms: null,
				hit_ms: null,
				recommended_ttl_ms: null,
			},
		];

		// No precise match at all — a pinned entry carries only its slice tag, and
		// the coarse purge recorded no slice tags.
		rowsByTable['directus_scoped_cache_entry_tags as et'] = [];

		// The coarse pass, joined on collection rather than on tag.
		rowsByTable['directus_scoped_cache_purge_tags as pt'] = [
			{ cache_key: 'pinned', purges: '2' },
		];

		const entries = await listCacheEntries();

		expect(mockDb).toHaveBeenCalledWith('directus_scoped_cache_purge_tags as pt');
		expect(entries[0]!.purges).toBe(2);
	});

	it('adds the precise and coarse passes rather than taking one', async () => {
		queryRows = [
			{
				cache_key: 'k1',
				redis_key: 'r1',
				coarse: false,
				method: 'GET',
				path: '/items/articles',
				collection: 'articles',
				user_id: null,
				user_email: null,
				query: '{}',
				url: '/items/articles',
				bytes: '10',
				last_filled: new Date(500).toISOString(),
				hits: '1',
				misses: '0',
				fills: '1',
				last_hit_at: null,
				ttl_ms: null,
				fill_ms: null,
				hit_ms: null,
				recommended_ttl_ms: null,
			},
		];

		// A purge is only ever tag-bearing or collection-bearing, never both, so
		// the two passes cannot double-count one purge and simply add.
		rowsByTable['directus_scoped_cache_entry_tags as et'] = [
			{ cache_key: 'k1', purges: '3' },
		];

		rowsByTable['directus_scoped_cache_purge_tags as pt'] = [
			{ cache_key: 'k1', purges: '4' },
		];

		const entries = await listCacheEntries();

		expect(entries[0]!.purges).toBe(7);
	});

	it('asks for no purge counts when nothing was listed', async () => {
		queryRows = [];

		await expect(listCacheEntries()).resolves.toEqual([]);

		// An empty `whereIn` would scan the whole join for rows nothing can use.
		expect(mockDb)
			.not.toHaveBeenCalledWith('directus_scoped_cache_entry_tags as et');
	});

	it('maps descriptor + windowed hit rows to entry records', async () => {
		queryRows = [
			{
				cache_key: 'k1',
				redis_key: '/items/a?limit=5:u1',
				coarse: true,
				method: 'GET',
				path: '/items/a',
				collection: 'a',
				user_id: 'u1',
				user_email: 'alice@corp.io',
				query: 'limit=5',
				bytes: '42',
				last_filled: new Date(1000).toISOString(),
				hits: '3',
				misses: '1',
				fills: '2',
				last_hit_at: new Date(2000).toISOString(),
				ttl_ms: '300000',
				fill_ms: '240',
				hit_ms: '8.4',
				recommended_ttl_ms: '320000.4',
			},
			{
				cache_key: 'k2',
				redis_key: '',
				coarse: false,
				method: 'GET',
				path: '/items/b',
				collection: null,
				user_id: null,
				query: '{}',
				url: '',
				bytes: '0',
				last_filled: new Date(500).toISOString(),
				hits: '0',
				misses: '0',
				fills: '0',
				last_hit_at: null,
				ttl_ms: null,
				fill_ms: null,
				hit_ms: null,
				recommended_ttl_ms: null,
			},
		];

		const entries = await listCacheEntries();

		expect(mockDb).toHaveBeenCalledWith('directus_cache_descriptors as d');
		// Never-filled locators are excluded from the entries listing.
		expect(builder.whereNotNull).toHaveBeenCalledWith('d.last_filled');

		expect(entries).toEqual([
			{
				key: 'k1',
				// No purge-tag rows in this fixture, so nothing covered it.
				purges: 0,
				redisKey: '/items/a?limit=5:u1',
				coarse: true,
				method: 'GET',
				path: '/items/a',
				collection: 'a',
				user: { id: 'u1', email: 'alice@corp.io' },
				query: 'limit=5',
				url: '/items/a?limit=5',
				size: 42,
				hits: 3,
				misses: 1,
				fills: 2,
				fillMs: 240,
				hitMs: 8,
				ttlMs: 300000,
				recommendedTtlMs: 320000,
				createdAt: 1000,
				expiresAt: 301000,
				lastHitAt: 2000,
			},
			{
				key: 'k2',
				purges: 0,
				redisKey: '',
				coarse: false,
				method: 'GET',
				path: '/items/b',
				collection: null,
				user: null,
				query: '{}',
				// A GET that carried no query string is its path, and a row whose
				// query is still the old sanitized JSON cannot say more than that.
				url: '/items/b',
				size: 0,
				hits: 0,
				misses: 0,
				fills: 0,
				fillMs: null,
				hitMs: null,
				ttlMs: null,
				recommendedTtlMs: null,
				createdAt: 500,
				expiresAt: null,
				lastHitAt: null,
			},
		]);
	});

	// The ranking is decided in SQL and the merge must not re-derive it: reading
	// the order back off the descriptor lookup would re-rank the page by key.
	it('keeps the order the aggregate returned', async () => {
		queryRows = [
			{
				cache_key: 'k2',
				redis_key: 'r2',
				coarse: false,
				method: 'GET',
				path: '/items/b',
				collection: 'b',
				user_id: null,
				user_email: null,
				query: '{}',
				url: '/items/b',
				bytes: '10',
				last_filled: new Date(500).toISOString(),
				hits: '9',
				misses: '0',
				fills: '1',
				last_hit_at: null,
				ttl_ms: null,
				fill_ms: null,
				hit_ms: null,
				recommended_ttl_ms: null,
			},
			{
				cache_key: 'k1',
				redis_key: 'r1',
				coarse: false,
				method: 'GET',
				path: '/items/a',
				collection: 'a',
				user_id: null,
				user_email: null,
				query: '{}',
				url: '/items/a',
				bytes: '10',
				last_filled: new Date(500).toISOString(),
				hits: '2',
				misses: '0',
				fills: '1',
				last_hit_at: null,
				ttl_ms: null,
				fill_ms: null,
				hit_ms: null,
				recommended_ttl_ms: null,
			},
		];

		const entries = await listCacheEntries();

		expect(entries.map((entry) => [entry.key, entry.hits])).toEqual([
			['k2', 9],
			['k1', 2],
		]);

		expect(builder.orderBy).toHaveBeenCalledWith('hits', 'desc');
		expect(builder.limit).toHaveBeenCalledWith(200);
	});

	// Two reads merged by key, so a merge keyed on position instead would hand
	// each entry the other one's descriptor.
	it('ranks on the events and pairs each descriptor by key', async () => {
		rowsByTable['directus_cache_events as e'] = [
			{
				cache_key: 'k2',
				hits: '9',
				misses: '1',
				fills: '1',
				last_hit_at: null,
				ttl_ms: null,
				hit_ms: null,
				recommended_ttl_ms: null,
			},
			{
				cache_key: 'k1',
				hits: '2',
				misses: '0',
				fills: '1',
				last_hit_at: null,
				ttl_ms: null,
				hit_ms: null,
				recommended_ttl_ms: null,
			},
		];

		// Deliberately the other order, and keyed the other way round.
		rowsByTable['directus_cache_descriptors as d'] = [
			{
				cache_key: 'k1',
				redis_key: 'r1',
				coarse: false,
				method: 'GET',
				path: '/items/a',
				collection: 'a',
				user_id: null,
				user_email: null,
				query: '{}',
				url: '/items/a',
				bytes: '10',
				fill_ms: null,
				last_filled: new Date(500).toISOString(),
			},
			{
				cache_key: 'k2',
				redis_key: 'r2',
				coarse: false,
				method: 'GET',
				path: '/items/b',
				collection: 'b',
				user_id: null,
				user_email: null,
				query: '{}',
				url: '/items/b',
				bytes: '20',
				fill_ms: null,
				last_filled: new Date(500).toISOString(),
			},
		];

		const entries = await listCacheEntries();

		expect(entries.map((entry) => [entry.key, entry.hits, entry.path]))
			.toEqual([
				['k2', 9, '/items/b'],
				['k1', 2, '/items/a'],
			]);

		expect(mockDb).toHaveBeenCalledWith('directus_cache_events as e');
		expect(builder.whereIn).toHaveBeenCalledWith('d.cache_key', ['k2', 'k1']);
	});

	// The descriptor's thirteen columns are dimensions OF the key, so grouping on
	// them only widened the key; the aggregate needs nothing but the key itself.
	it('groups the aggregate on the cache key alone', async () => {
		queryRows = [
			{
				cache_key: 'k1',
				redis_key: 'r1',
				coarse: false,
				method: 'GET',
				path: '/items/a',
				collection: 'a',
				user_id: null,
				user_email: null,
				query: 'limit=5',
				bytes: '10',
				last_filled: new Date(500).toISOString(),
				hits: '2',
				misses: '0',
				fills: '1',
				last_hit_at: null,
				ttl_ms: null,
				fill_ms: null,
				hit_ms: null,
				recommended_ttl_ms: null,
			},
		];

		await listCacheEntries();

		// The two trailing calls are the tag and collection purge passes.
		expect(builder.groupBy.mock.calls).toEqual([
			['e.cache_key'],
			['et.cache_key'],
			['et.cache_key'],
		]);
	});

	// Excluded as a semi-join rather than as a join column, which is what keeps
	// the exclusion out of the grouping key.
	it('excludes never-filled locators through a correlated EXISTS', async () => {
		queryRows = [
			{
				cache_key: 'k1',
				redis_key: 'r1',
				coarse: false,
				method: 'GET',
				path: '/items/a',
				collection: 'a',
				user_id: null,
				user_email: null,
				query: '{}',
				url: '/items/a',
				bytes: '10',
				last_filled: new Date(500).toISOString(),
				hits: '2',
				misses: '0',
				fills: '1',
				last_hit_at: null,
				ttl_ms: null,
				fill_ms: null,
				hit_ms: null,
				recommended_ttl_ms: null,
			},
		];

		await listCacheEntries();

		expect(builder.whereExists).toHaveBeenCalledTimes(1);
		expect(builder.from).toHaveBeenCalledWith('directus_cache_descriptors as d');

		expect(builder.whereRaw).toHaveBeenCalledWith(
			'?? = ??',
			['d.cache_key', 'e.cache_key'],
		);

		expect(builder.whereNotNull).toHaveBeenCalledWith('d.last_filled');
	});

	// The two reads are not atomic: a reap between them leaves an aggregated key
	// with no dimension row, and a record built from it would carry a NaN date.
	it('drops a key whose descriptor went away between the two reads', async () => {
		rowsByTable['directus_cache_events as e'] = [
			{
				cache_key: 'reaped',
				hits: '9',
				misses: '0',
				fills: '1',
				last_hit_at: null,
				ttl_ms: null,
				hit_ms: null,
				recommended_ttl_ms: null,
			},
			{
				cache_key: 'kept',
				hits: '2',
				misses: '0',
				fills: '1',
				last_hit_at: null,
				ttl_ms: null,
				hit_ms: null,
				recommended_ttl_ms: null,
			},
		];

		rowsByTable['directus_cache_descriptors as d'] = [
			{
				cache_key: 'kept',
				redis_key: 'r1',
				coarse: false,
				method: 'GET',
				path: '/items/a',
				collection: 'a',
				user_id: null,
				user_email: null,
				query: '{}',
				url: '/items/a',
				bytes: '10',
				fill_ms: null,
				last_filled: new Date(500).toISOString(),
			},
		];

		const entries = await listCacheEntries();

		expect(entries.map((entry) => [entry.key, entry.createdAt]))
			.toEqual([['kept', 500]]);
	});

	// Its own default, shorter than the 24h the anomaly and timeseries reads
	// share, because this one aggregates every event in the window.
	it('windows the listing over the last ten minutes by default', async () => {
		const now = 1_700_000_000_000;
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

		await listCacheEntries();

		expect(builder.where).toHaveBeenCalledWith(
			'e.time',
			'>',
			new Date(now - 600_000),
		);

		nowSpy.mockRestore();
	});

	it('windows the listing over an explicitly asked span', async () => {
		const now = 1_700_000_000_000;
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

		await listCacheEntries(21_600_000);

		expect(builder.where).toHaveBeenCalledWith(
			'e.time',
			'>',
			new Date(now - 21_600_000),
		);

		nowSpy.mockRestore();
	});

	it('returns an empty array when not configured', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		expect(await listCacheEntries()).toEqual([]);
	});
});

describe('listCacheGroupLatencies', () => {
	it('maps query rows and the endpoint rollup', async () => {
		queryRows = [
			{
				path: '/items/a',
				method_rolled_up: '0',
				method: 'GET',
				query: '{"limit":5}',
				response_p50: '20',
				response_p95: '90.4',
				response_p99: '400',
				miss_p50: '110',
				miss_p95: '240.6',
				miss_p99: '900',
				anomaly_p50: '70',
				anomaly_p95: '75',
				anomaly_p99: '80',
				fill_p50: '120',
				fill_p95: '250',
				fill_p99: '910',
				hit_p50: '8',
				hit_p95: '15.4',
				hit_p99: '22',
			},
			{
				path: '/items/a',
				method_rolled_up: '1',
				method: null,
				query: null,
				response_p50: '21',
				response_p95: null,
				response_p99: '380',
				miss_p50: null,
				miss_p95: '231',
				miss_p99: '880',
				anomaly_p50: null,
				anomaly_p95: null,
				anomaly_p99: null,
				fill_p50: '105',
				fill_p95: null,
				fill_p99: '870',
				hit_p50: '9',
				hit_p95: '14.8',
				hit_p99: null,
			},
		];

		const latencies = await listCacheGroupLatencies();

		expect(mockDb).toHaveBeenCalledWith('directus_cache_descriptors as d');
		// Kind 1 is a bare miss count with no timing, so it never reaches a
		// percentile; events with no timing and never-filled locators are out too.
		expect(builder.whereIn).toHaveBeenCalledWith('e.kind', [0, 2, 3, 4]);
		expect(builder.whereNotNull).toHaveBeenCalledWith('e.duration_ms');
		expect(builder.whereNotNull).toHaveBeenCalledWith('d.last_filled');

		expect(builder.groupByRaw).toHaveBeenCalledWith(
			'GROUPING SETS ((d.path, d.method, d.query), (d.path))',
		);

		expect(latencies).toEqual([
			{
				path: '/items/a',
				method: 'GET',
				query: '{"limit":5}',
				response: { p50: 20, p95: 90, p99: 400 },
				miss: { p50: 110, p95: 241, p99: 900 },
				anomaly: { p50: 70, p95: 75, p99: 80 },
				fill: { p50: 120, p95: 250, p99: 910 },
				hit: { p50: 8, p95: 15, p99: 22 },
			},
			{
				path: '/items/a',
				method: null,
				query: null,
				response: { p50: 21, p95: null, p99: 380 },
				miss: { p50: null, p95: 231, p99: 880 },
				anomaly: { p50: null, p95: null, p99: null },
				fill: { p50: 105, p95: null, p99: 870 },
				hit: { p50: 9, p95: 15, p99: null },
			},
		]);
	});

	it('filters each metric to its own event kinds', async () => {
		queryRows = [];
		await listCacheGroupLatencies();

		const selected = mockDb.raw.mock.calls.map((call: unknown[]) => call[0]);

		expect(selected).toContain(
			'percentile_cont(0.95) WITHIN GROUP (ORDER BY e.duration_ms) '
			+ 'FILTER (WHERE e.kind IN (0, 2, 3, 4)) AS response_p95',
		);

		expect(selected).toContain(
			'percentile_cont(0.95) WITHIN GROUP (ORDER BY e.duration_ms) '
			+ 'FILTER (WHERE e.kind IN (2, 3, 4)) AS miss_p95',
		);

		expect(selected).toContain(
			'percentile_cont(0.5) WITHIN GROUP (ORDER BY e.duration_ms) '
			+ 'FILTER (WHERE e.kind = 3) AS anomaly_p50',
		);

		// Fill is the cached slice of the miss compute, anomaly the flagged one —
		// each a single kind, not the pooled 2/3/4 above.
		expect(selected).toContain(
			'percentile_cont(0.5) WITHIN GROUP (ORDER BY e.duration_ms) '
			+ 'FILTER (WHERE e.kind = 2) AS fill_p50',
		);

		expect(selected).toContain(
			'percentile_cont(0.99) WITHIN GROUP (ORDER BY e.duration_ms) '
			+ 'FILTER (WHERE e.kind = 0) AS hit_p99',
		);
	});

	// Its own default, shorter than the 24h the anomaly and timeseries reads share,
	// because this one runs fifteen ordered-set aggregates over the whole window.
	it('windows the latencies over the last ten minutes by default', async () => {
		const now = 1_700_000_000_000;
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

		queryRows = [];
		await listCacheGroupLatencies();

		expect(builder.where).toHaveBeenCalledWith(
			'e.time',
			'>',
			new Date(now - 600_000),
		);

		nowSpy.mockRestore();
	});

	it('windows the latencies over an explicitly asked span', async () => {
		const now = 1_700_000_000_000;
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

		queryRows = [];
		await listCacheGroupLatencies(21_600_000);

		expect(builder.where).toHaveBeenCalledWith(
			'e.time',
			'>',
			new Date(now - 21_600_000),
		);

		nowSpy.mockRestore();
	});

	it('returns an empty array on a non-Postgres dialect', async () => {
		mockDb.client = { config: { client: 'sqlite3' } };
		expect(await listCacheGroupLatencies()).toEqual([]);
		expect(mockDb).not.toHaveBeenCalledWith('directus_cache_descriptors as d');
	});

	it('returns an empty array when not configured', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		expect(await listCacheGroupLatencies()).toEqual([]);
	});
});

describe('evictCacheEntry', () => {
	it('deletes the value and its siblings', async () => {
		const cache = { delete: vi.fn() };

		await evictCacheEntry(cache as any, 'k1');

		expect(cache.delete).toHaveBeenCalledWith('k1');
		expect(cache.delete).toHaveBeenCalledWith('k1__expires_at');
		expect(cache.delete).toHaveBeenCalledWith('k1__tags');
	});
});

describe('evictCacheEntriesForPath', () => {
	it('evicts every described key on the path and returns the count', async () => {
		const cache = { delete: vi.fn() };
		pluckResult = ['k1', 'k2'];

		const count = await evictCacheEntriesForPath(cache as any, '/items/a');

		expect(count).toBe(2);
		expect(builder.where).toHaveBeenCalledWith({ path: '/items/a' });
		expect(builder.pluck).toHaveBeenCalledWith('redis_key');
		expect(cache.delete).toHaveBeenCalledWith('k1');
		expect(cache.delete).toHaveBeenCalledWith('k2');
	});

	it('returns 0 without touching the cache when not configured', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		const cache = { delete: vi.fn() };

		expect(await evictCacheEntriesForPath(cache as any, '/x')).toBe(0);
		expect(cache.delete).not.toHaveBeenCalled();
	});
});

describe('listCacheAnomalies', () => {
	it('maps grouped anomaly rows joined to their descriptor', async () => {
		queryRows = [
			{
				cache_key: 'k9',
				reason: 'value_too_large',
				path: '/items/big',
				method: 'GET',
				query: 'limit=5',
				count: '4',
				sample: '2048B',
				last_seen: new Date(2000).toISOString(),
			},
		];

		const rows = await listCacheAnomalies();

		expect(mockDb).toHaveBeenCalledWith('directus_cache_anomalies as a');

		expect(builder.join).toHaveBeenCalledWith(
			'directus_cache_descriptors as d',
			'd.cache_key',
			'a.cache_key',
		);

		expect(rows).toEqual([
			{
				cacheKey: 'k9',
				reason: 'value_too_large',
				path: '/items/big',
				method: 'GET',
				query: 'limit=5',
				// Rebuilt from path + query rather than read from a column that
				// stored the path a second time.
				url: '/items/big?limit=5',
				count: 4,
				sample: '2048B',
				lastSeen: 2000,
			},
		]);
	});

	it('returns an empty list when not configured', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		expect(await listCacheAnomalies()).toEqual([]);
	});
});

describe('reapCacheAnomalies', () => {
	it('deletes anomaly rows past the retention window', async () => {
		deleteCount = 5;

		expect(await reapCacheAnomalies()).toBe(5);
		expect(mockDb).toHaveBeenCalledWith('directus_cache_anomalies');
		expect(builder.delete).toHaveBeenCalled();
	});
});

describe('reapCachePurges', () => {
	it('deletes purge rows past the retention window', async () => {
		deleteCount = 4;

		expect(await reapCachePurges()).toBe(4);
		expect(mockDb).toHaveBeenCalledWith('directus_cache_purges');
		expect(builder.delete).toHaveBeenCalled();
	});

	it('returns 0 without touching the table when not configured', async () => {
		// The daily job runs on every deployment, including those that never
		// enabled cache stats and so have no rows — and, on a fresh one, no table.
		vi.mocked(redisConfigAvailable).mockReturnValue(false);

		expect(await reapCachePurges()).toBe(0);
		expect(mockDb).not.toHaveBeenCalledWith('directus_cache_purges');
	});
});

describe('queueCachePurge', () => {
	it('emits the reach and the size of one purge', async () => {
		await armFlag(null);

		queueCachePurge({
			collection: 'articles',
			mode: 'collection',
			scopedCacheTags: null,
			scopedCacheTagCount: 3,
			evicted: 12,
			durationMs: 12,
		});

		await flushCacheEventBuffer();
		const call = mockRedis.call.mock.calls[0]!;
		expect(call[0]).toBe('XADD');
		expect(fieldAfter(call, 'kind')).toBe('p');
		expect(fieldAfter(call, 'collection')).toBe('articles');
		expect(fieldAfter(call, 'mode')).toBe('collection');
		expect(fieldAfter(call, 'scopedCacheTags')).toBe('');
		expect(fieldAfter(call, 'scopedCacheTagCount')).toBe('3');
		expect(fieldAfter(call, 'evicted')).toBe('12');
		expect(fieldAfter(call, 'durationMs')).toBe('12');
	});

	// A namespace clear has no member list to count, so the size is unknown
	// rather than zero — `0` would draw the most destructive event in the system
	// as one that took nothing.
	it('emits an unknown size rather than zero for a namespace clear', async () => {
		await armFlag(null);

		queueCachePurge({
			collection: null,
			mode: 'namespace',
			scopedCacheTags: null,
			scopedCacheTagCount: 0,
			evicted: null,
			durationMs: 12,
		});

		await flushCacheEventBuffer();
		const call = mockRedis.call.mock.calls[0]!;
		expect(fieldAfter(call, 'mode')).toBe('namespace');
		expect(fieldAfter(call, 'collection')).toBe('');
		expect(fieldAfter(call, 'evicted')).toBe('');
	});

	// `recordCacheConfigEvent` is deliberately ungated so a flush made while
	// stats were off still shows once they return. A purge is the same class of
	// event, and the watchdog that kills capture kills it for hit/miss VOLUME —
	// purges are mutation-rate and are not what it defends against.
	it('records while capture is switched off, as a flush marker does', async () => {
		await armFlag('0');

		queueCachePurge({
			collection: 'articles',
			mode: 'slices',
			scopedCacheTags: ['articles:id=1'],
			scopedCacheTagCount: 1,
			evicted: 2,
			durationMs: 12,
		});

		await flushCacheEventBuffer();

		expect(mockRedis.call).toHaveBeenCalled();
		expect(fieldAfter(mockRedis.call.mock.calls[0]!, 'kind')).toBe('p');
	});

	it('stays silent where cache stats are not configured at all', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		await armFlag(null);

		queueCachePurge({
			collection: 'articles',
			mode: 'slices',
			scopedCacheTags: ['articles:id=1'],
			scopedCacheTagCount: 1,
			evicted: 2,
			durationMs: 12,
		});

		await flushCacheEventBuffer();

		expect(mockRedis.call).not.toHaveBeenCalled();
	});
});

describe('reapScopedCachePurgeTags', () => {
	it('deletes tag rows past the retention window', async () => {
		deleteCount = 7;

		expect(await reapScopedCachePurgeTags()).toBe(7);
		expect(mockDb).toHaveBeenCalledWith('directus_scoped_cache_purge_tags');
	});

	it('returns 0 without touching the table when not configured', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);

		expect(await reapScopedCachePurgeTags()).toBe(0);
		expect(mockDb).not.toHaveBeenCalledWith('directus_scoped_cache_purge_tags');
	});
});

describe('reapScopedCacheEntryTags', () => {
	it('drops tag rows whose entry no longer has a descriptor', async () => {
		rowsByTable['directus_scoped_cache_entry_tags'] = [
			{ cache_key: 'a' },
			{ cache_key: 'a' },
			{ cache_key: 'b' },
		];

		deleteCount = 3;

		expect(await reapScopedCacheEntryTags()).toBe(3);
		expect(mockDb).toHaveBeenCalledWith('directus_scoped_cache_entry_tags');

		// Followed out by their descriptor rather than aged out by time: the tags
		// are a dimension of the entry, not a fact of their own.
		expect(builder.whereRaw).toHaveBeenCalledWith(
			'??.cache_key = ??.cache_key',
			['directus_cache_descriptors', 'directus_scoped_cache_entry_tags'],
		);

		// One row per key per tag, so the slate names each key once however many
		// rows it read for it.
		expect(builder.whereIn).toHaveBeenCalledWith('cache_key', ['a', 'b']);
	});

	it('returns 0 without touching the table when not configured', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);

		expect(await reapScopedCacheEntryTags()).toBe(0);
		expect(mockDb).not.toHaveBeenCalledWith('directus_scoped_cache_entry_tags');
	});
});

describe('reapCacheDescriptors', () => {
	beforeEach(() => {
		mockGetCache.mockReturnValue({ cache: mockCache });
		mockCache.hasMany.mockResolvedValue([]);
	});

	it('deletes a descriptor whose cached entry is gone', async () => {
		rowsByTable['directus_cache_descriptors'] = [
			{ cache_key: 'a', redis_key: 'ra' },
		];

		mockCache.hasMany.mockResolvedValue([false]);
		deleteCount = 3;

		expect(await reapCacheDescriptors()).toBe(3);
		expect(mockDb).toHaveBeenCalledWith('directus_cache_descriptors');

		// Asked of Keyv by the key the entry is stored under, not of a raw key this
		// would have to rebuild through two layers of namespacing.
		expect(mockCache.hasMany).toHaveBeenCalledWith(['ra']);
		expect(builder.select).toHaveBeenCalledWith('redis_key');

		// A live event or anomaly still holds the descriptor: a re-anomalied
		// dormant key keeps it for the anomaly join.
		for (const fact of ['directus_cache_events', 'directus_cache_anomalies']) {
			expect(builder.whereRaw).toHaveBeenCalledWith(
				'??.cache_key = ??.cache_key',
				[fact, 'directus_cache_descriptors'],
			);
		}

		expect(builder.whereIn).toHaveBeenCalledWith('cache_key', ['a']);
		expect(builder.delete).toHaveBeenCalledTimes(1);
	});

	it('keeps a descriptor whose entry is still cached', async () => {
		rowsByTable['directus_cache_descriptors'] = [
			{ cache_key: 'a', redis_key: 'ra' },
		];

		mockCache.hasMany.mockResolvedValue([true]);

		// The rest of the orphan rule passed and the entry is still there, which
		// is the whole reason this test of liveness replaced an age window.
		expect(await reapCacheDescriptors()).toBe(0);
		expect(builder.delete).not.toHaveBeenCalled();
	});

	it('deletes only the keys of the slate whose entries are gone', async () => {
		rowsByTable['directus_cache_descriptors'] = [
			{ cache_key: 'live', redis_key: 'r-live' },
			{ cache_key: 'gone', redis_key: 'r-gone' },
			{ cache_key: 'also-live', redis_key: 'r-also-live' },
		];

		mockCache.hasMany.mockResolvedValue([true, false, true]);
		deleteCount = 1;

		expect(await reapCacheDescriptors()).toBe(1);
		expect(builder.whereIn).toHaveBeenCalledWith('cache_key', ['gone']);
	});

	it('treats every entry as gone when there is no cache to ask', async () => {
		rowsByTable['directus_cache_descriptors'] = [
			{ cache_key: 'a', redis_key: 'ra' },
		];

		mockGetCache.mockReturnValue({ cache: null } as never);
		deleteCount = 1;

		expect(await reapCacheDescriptors()).toBe(1);
		expect(builder.whereIn).toHaveBeenCalledWith('cache_key', ['a']);
	});

	it('takes another pass while the slate comes back full', async () => {
		rowsByTable['directus_cache_descriptors'] = Array.from(
			{ length: 5000 },
			(_unused, index) => ({ cache_key: `key-${index}` }),
		);

		deleteCount = 5000;

		// Four passes then stop: a full slate means more orphans are waiting, and
		// the next tick takes them rather than this one running unbounded.
		expect(await reapCacheDescriptors()).toBe(20_000);
		expect(builder.limit).toHaveBeenCalledWith(5000);
		expect(builder.delete).toHaveBeenCalledTimes(4);
	});

	it('deletes nothing when the slate comes back empty', async () => {
		rowsByTable['directus_cache_descriptors'] = [];

		expect(await reapCacheDescriptors()).toBe(0);
		expect(builder.delete).not.toHaveBeenCalled();
	});

	it('returns 0 when not configured', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		expect(await reapCacheDescriptors()).toBe(0);
	});
});

describe('reapCacheEvents', () => {
	it('prunes fact rows strictly older than the retention cutoff', async () => {
		const now = 1_700_000_000_000;
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
		deleteCount = 7;

		const reaped = await reapCacheEvents();

		expect(reaped).toBe(7);
		expect(mockDb).toHaveBeenCalledWith('directus_cache_events');

		// default CACHE_STATS_RETENTION = 30d; cutoff is now - 30d, not now + 30d.
		expect(builder.where).toHaveBeenCalledWith(
			'time',
			'<',
			new Date(now - 2_592_000_000),
		);

		expect(builder.delete).toHaveBeenCalled();

		nowSpy.mockRestore();
	});

	it('returns 0 when not configured', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		expect(await reapCacheEvents()).toBe(0);
	});
});

describe('buffer cap under a stalled flush', () => {
	it('drops events past the cap during a stalled flush', async () => {
		// Fresh module so the dropped counter + flush latch stay isolated: a leaked
		// latch would silently break a later test's flush, and static droppedEvents
		// stays 0 regardless of file order.
		vi.resetModules();
		const fresh = await import('./cache-events.js');

		mockRedis.get.mockResolvedValueOnce(null);
		await fresh.refreshCacheStatsFlag();

		let releaseFlush: () => void = () => {};

		const flushGate = new Promise<void>((resolve) => {
			releaseFlush = resolve;
		});

		// Hold the pipelined flush open so the buffer stays in flight and can't drain.
		mockRedis.pipeline.mockReturnValue({
			call() {
				return this;
			},
			exec: () => flushGate.then(() => []),
		});

		// Fill past the cap (1000) twice over: the first cap-hit starts the stalled
		// flush, then every event beyond a full buffer while it's in flight is dropped.
		const hit = { cacheKey: 'k', ageMs: 1, ttlMs: 1, durationMs: 1 };

		for (let i = 0; i < 2100; i += 1) {
			await fresh.queueCacheHit(hit);
		}

		expect((await fresh.getCacheStatsState()).droppedEvents).toBeGreaterThan(0);

		// Drain the held flush so nothing dangles past this test.
		releaseFlush();
		await flushGate;
	});
});

// The TTL series is a replay of the config's history, not a measurement, so all of
// its correctness lives here. Buckets are 10 units apart throughout.
describe('effectiveTtlByBucket', () => {
	const buckets = [0, 10, 20, 30, 40];

	it('holds the value the window opened on when nothing changed inside it', () => {
		expect(effectiveTtlByBucket(buckets, [], 3_600_000))
			.toEqual([3_600_000, 3_600_000, 3_600_000, 3_600_000, 3_600_000]);
	});

	it('applies a change from the bucket containing it onward', () => {
		const changes = [{ time: 25, ttlMs: 86_400_000 }];

		expect(effectiveTtlByBucket(buckets, changes, 3_600_000))
			.toEqual([3_600_000, 3_600_000, 86_400_000, 86_400_000, 86_400_000]);
	});

	it('leaves the lead unknown rather than back-filling a later value', () => {
		// The reset that motivated this: with no change recorded before the window, the
		// buckets before the first one are genuinely unknown. Reporting 24h there would
		// claim it was in force over a span it had not been set in.
		const changes = [{ time: 25, ttlMs: 86_400_000 }];

		expect(effectiveTtlByBucket(buckets, changes, null))
			.toEqual([null, null, 86_400_000, 86_400_000, 86_400_000]);
	});

	it('follows a cleared override back down to the env fallback', () => {
		// A clear resolves to the env value before it gets here, so the series steps
		// down at the reset instead of holding the override it replaced.
		const changes = [
			{ time: 5, ttlMs: 86_400_000 },
			{ time: 25, ttlMs: 3_600_000 },
		];

		expect(effectiveTtlByBucket(buckets, changes, null))
			.toEqual([86_400_000, 86_400_000, 3_600_000, 3_600_000, 3_600_000]);
	});

	it('keeps only the last of several changes inside one bucket', () => {
		const changes = [
			{ time: 21, ttlMs: 60_000 },
			{ time: 22, ttlMs: 120_000 },
			{ time: 23, ttlMs: 300_000 },
		];

		expect(effectiveTtlByBucket(buckets, changes, null))
			.toEqual([null, null, 300_000, 300_000, 300_000]);
	});

	it('orders changes by time rather than trusting the argument order', () => {
		const changes = [
			{ time: 35, ttlMs: 300_000 },
			{ time: 15, ttlMs: 60_000 },
		];

		expect(effectiveTtlByBucket(buckets, changes, null))
			.toEqual([null, 60_000, 60_000, 300_000, 300_000]);
	});

	it('carries a change landing in the final bucket to the window end', () => {
		const changes = [{ time: 44, ttlMs: 300_000 }];

		expect(effectiveTtlByBucket(buckets, changes, 60_000))
			.toEqual([60_000, 60_000, 60_000, 60_000, 300_000]);
	});

	it('returns nothing for an empty grid', () => {
		expect(effectiveTtlByBucket([], [{ time: 5, ttlMs: 60_000 }], null)).toEqual([]);
	});

	it('stays unknown throughout when neither a seed nor a change exists', () => {
		// The caller is responsible for not landing here in the ordinary no-marker
		// case — see the seed in `readCacheTimeseries`, which passes the value in
		// force instead. Given nothing at all, the honest answer is nothing.
		expect(effectiveTtlByBucket(buckets, [], null))
			.toEqual([null, null, null, null, null]);
	});
});

describe('listPurgesCoveringEntry', () => {
	// The two reaches answer separately — a purge names a tag the entry was filled
	// under, or it names none and its collection is its reach — so the merge, the
	// ordering across them and the cap are this function's own work.
	it('merges both reaches into one list, newest first', async () => {
		rowsByTable['directus_scoped_cache_entry_tags as et'] = [
			{
				purge_id: 'p-old',
				time: new Date(1_000).toISOString(),
				mode: 'slices',
				collection: 'articles',
				scoped_cache_tag: 'articles:id=5',
				evicted: 2,
			},
		];

		rowsByTable['directus_scoped_cache_purge_tags as pt'] = [
			{
				purge_id: 'p-new',
				time: new Date(9_000).toISOString(),
				mode: 'collection',
				collection: 'articles',
				// A collection-wide purge names no tag; the empty string is how the
				// row spells that, and null is how the answer says it outward.
				scoped_cache_tag: '',
				evicted: null,
			},
		];

		const covering = await listPurgesCoveringEntry('k1', new Date(500));

		expect(covering).toEqual([
			{
				time: 9_000,
				mode: 'collection',
				collection: 'articles',
				scopedCacheTag: null,
				evicted: null,
			},
			{
				time: 1_000,
				mode: 'slices',
				collection: 'articles',
				scopedCacheTag: 'articles:id=5',
				evicted: 2,
			},
		]);

		// Bounded by the entry's own fill, not by a retention window.
		expect(builder.where).toHaveBeenCalledWith('pt.time', '>', new Date(500));

		// One purge covering two of the entry's tags is one row, not two.
		expect(builder.distinct).toHaveBeenCalled();
	});

	it('counts a purge that covered several of the entry\'s tags once', async () => {
		// A mutation touching two rows drops a tag per row, and an entry that read
		// both carries both — so the join answers the same purge twice, differing
		// only in which tag matched. The listing counts it once
		// (`COUNT(DISTINCT purge_id)`), and this has to agree with that.
		rowsByTable['directus_scoped_cache_entry_tags as et'] = [
			{
				purge_id: 'p-wide',
				time: new Date(4_000).toISOString(),
				mode: 'slices',
				collection: 'articles',
				scoped_cache_tag: 'articles:id=5',
				evicted: 7,
			},
			{
				purge_id: 'p-wide',
				time: new Date(4_000).toISOString(),
				mode: 'slices',
				collection: 'articles',
				scoped_cache_tag: 'articles:id=6',
				evicted: 7,
			},
		];

		const covering = await listPurgesCoveringEntry('k1', new Date(500));

		// One record, and the tag kept is the one the ordering makes first, so a
		// re-read answers the same string rather than whichever row came back.
		expect(covering).toEqual([
			{
				time: 4_000,
				mode: 'slices',
				collection: 'articles',
				scopedCacheTag: 'articles:id=5',
				evicted: 7,
			},
		]);

		expect(builder.orderBy).toHaveBeenCalledWith('pt.scoped_cache_tag', 'asc');
	});

	// A namespace clear names neither a tag nor a collection, so it leaves no
	// `purge_tags` row for either reach to join — and it took every entry, this
	// one included. Missing it would answer "nothing purged this" about the most
	// total invalidation there is.
	it('names a namespace clear, which no tag or collection joins', async () => {
		rowsByTable['directus_cache_purges as p'] = [
			{
				purge_id: 'p-clear',
				time: new Date(6_000).toISOString(),
				mode: 'namespace',
				collection: null,
				evicted: null,
			},
		];

		rowsByTable['directus_scoped_cache_entry_tags as et'] = [
			{
				purge_id: 'p-tagged',
				time: new Date(2_000).toISOString(),
				mode: 'slices',
				collection: 'articles',
				scoped_cache_tag: 'articles:id=5',
				evicted: 1,
			},
		];

		const covering = await listPurgesCoveringEntry('k1', new Date(500));

		expect(covering).toEqual([
			{
				time: 6_000,
				mode: 'namespace',
				// It named no scope at all, which is what made it reach everything.
				collection: null,
				scopedCacheTag: null,
				evicted: null,
			},
			{
				time: 2_000,
				mode: 'slices',
				collection: 'articles',
				scopedCacheTag: 'articles:id=5',
				evicted: 1,
			},
		]);

		expect(builder.where).toHaveBeenCalledWith('p.mode', 'namespace');
		expect(builder.where).toHaveBeenCalledWith('p.time', '>', new Date(500));
	});

	it('answers nothing where telemetry was never configured', async () => {
		env['CACHE_STATS_ENABLED'] = false;
		queryRows = [{ purge_id: 'p1', time: new Date(1).toISOString() }];

		await expect(listPurgesCoveringEntry('k1', new Date(0))).resolves.toEqual([]);

		// Not merely empty: no query was built at all.
		expect(mockDb)
			.not
			.toHaveBeenCalledWith('directus_scoped_cache_entry_tags as et');
	});
});

describe('readCacheDescriptorForRedisKey', () => {
	// The two columns hold the same digest unless CACHE_KEY_HASH_ENABLED is off,
	// so the primary-key arm answers on any hashing install and the TEXT scan is
	// only ever paid by a readable-key one.
	it('answers from the primary key without a second query', async () => {
		firstRows = [{ cache_key: 'h1', last_filled: new Date(7).toISOString() }];

		await expect(readCacheDescriptorForRedisKey('h1')).resolves.toEqual({
			cacheKey: 'h1',
			lastFilled: new Date(7),
		});

		expect(builder.where).toHaveBeenCalledWith('cache_key', 'h1');
		expect(builder.where).not.toHaveBeenCalledWith('redis_key', 'h1');
	});

	it('falls back to the redis key where the identity misses', async () => {
		// A readable Redis key: the identity column holds a digest it never equals.
		firstRows = [
			undefined,
			{ cache_key: 'h2', last_filled: new Date(8).toISOString() },
		];

		await expect(readCacheDescriptorForRedisKey('{"path":"/items/a"}'))
			.resolves
			.toEqual({ cacheKey: 'h2', lastFilled: new Date(8) });

		expect(builder.where).toHaveBeenCalledWith('redis_key', '{"path":"/items/a"}');
	});

	it('answers null for a key neither column knows', async () => {
		firstRows = [undefined, undefined];

		await expect(readCacheDescriptorForRedisKey('nope')).resolves.toBeNull();
	});

	it('never probes on an empty key', async () => {
		// `redis_key` defaults to '' on rows predating the column and on anomaly
		// locators, so an empty probe would match all of them at once.
		firstRows = [{ cache_key: 'h3', last_filled: new Date(9).toISOString() }];

		await expect(readCacheDescriptorForRedisKey('')).resolves.toBeNull();
		expect(builder.first).not.toHaveBeenCalled();
	});

	it('answers null for a descriptor that was never filled', async () => {
		// An anomaly locator: a descriptor written where the response was declined,
		// so `last_filled` is NULL. `new Date(null)` is the epoch, which would have
		// it report a fill on 1970-01-01 and take every purge recorded since with
		// it — and the anomaly listing hands out exactly this key.
		firstRows = [{ cache_key: 'h5', last_filled: null }];

		await expect(readCacheDescriptorForRedisKey('h5')).resolves.toBeNull();

		// The row was found, not missed: it is the fill that is absent.
		expect(builder.where).toHaveBeenCalledWith('cache_key', 'h5');
	});

	it('answers null where telemetry was never configured', async () => {
		env['CACHE_STATS_ENABLED'] = false;
		firstRows = [{ cache_key: 'h4', last_filled: new Date(9).toISOString() }];

		await expect(readCacheDescriptorForRedisKey('h4')).resolves.toBeNull();
		expect(builder.first).not.toHaveBeenCalled();
	});
});

describe('readCacheTombstone', () => {
	// A tombstone outlives the entry, so it is what tells an inspection when the
	// key last expired rather than that it was simply never there.
	it('answers when the key last expired', async () => {
		mockRedis.get.mockResolvedValue('1700');

		await expect(readCacheTombstone('r1')).resolves.toBe(1700);
		expect(mockRedis.get).toHaveBeenCalledWith('scalabus:stats:tomb:r1');
	});

	it('answers null where no tombstone outlived it', async () => {
		mockRedis.get.mockResolvedValue(null);

		await expect(readCacheTombstone('r1')).resolves.toBeNull();
	});

	it('answers null with no redis to ask', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);

		await expect(readCacheTombstone('r1')).resolves.toBeNull();
		expect(mockRedis.get).not.toHaveBeenCalled();
	});
});
