import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
	cacheStatsActive,
	cacheStatsConfigured,
	queueCacheDescriptor,
	clampCacheStatsWindow,
	claimCacheAnomalyThrottleSlot,
	queueCacheAnomaly,
	queueCacheHit,
	queueCacheMiss,
	enforceCacheStatsBudget,
	evictCacheEntriesForPath,
	evictCacheEntry,
	drainCacheEvents,
	flushCacheEventBuffer,
	getCacheStatsState,
	listCacheAnomalies,
	listCacheEntries,
	readCacheMissGap,
	reapCacheAnomalies,
	reapCacheDescriptors,
	reapCacheEvents,
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
vi.mock('./logger/index.js', () => ({ useLogger: () => ({ warn: vi.fn() }) }));

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
let pluckResult: string[];
let deleteCount: number;

let mockDb: any;

beforeEach(() => {
	streamBatch = [];
	queryRows = [];
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
		where: vi.fn(() => builder),
		whereNull: vi.fn(() => builder),
		whereNotNull: vi.fn(() => builder),
		whereNotIn: vi.fn(() => builder),
		groupBy: vi.fn(() => builder),
		orderBy: vi.fn(() => builder),
		limit: vi.fn(() => builder),
		select: vi.fn(() => builder),
		distinct: vi.fn(() => builder),
		pluck: vi.fn(() => Promise.resolve(pluckResult)),
		delete: vi.fn(() => Promise.resolve(deleteCount)),
		then: (resolve: any, reject: any) => {
			return Promise.resolve(queryRows).then(resolve, reject);
		},
	};

	mockDb = vi.fn(() => builder);
	mockDb.batchInsert = vi.fn();
	mockDb.raw = vi.fn();
	mockDb.client = { config: { client: 'pg' } };

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
				url: '/items/a',
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
			expect.objectContaining({ cache_key: 'kx', bytes: 42, last_filled: new Date(1000) }),
		]);

		expect(builder.insert).toHaveBeenCalledWith([
			expect.objectContaining({ cache_key: 'kx', bytes: 0, last_filled: null }),
		]);

		// The real merge must run BEFORE the locator ignore, so a 0-byte locator can never
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

	it('reads through the consumer group, then acks + deletes each entry', async () => {
		streamBatch = [
			streamEntry('1-0', { kind: 'h', cacheKey: 'k', ageMs: '1', ttlMs: '1', ts: '1' }),
		];

		await drainCacheEvents();

		expect(mockRedis.call).toHaveBeenCalledWith(
			'XGROUP', 'CREATE', STREAM, 'drain', '0', 'MKSTREAM',
		);

		// '>' hands out only never-delivered entries, so a peer node's drain can't read
		// this same batch — the double-insert this replaced a raw XRANGE to prevent.
		expect(mockRedis.call).toHaveBeenCalledWith(
			'XREADGROUP', 'GROUP', 'drain', expect.any(String),
			'COUNT', '500', 'STREAMS', STREAM, '>',
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

	it('reclaims stale pending entries and re-drives them through the same path', async () => {
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
	it('auto-disables and records the reason when the buffer overflows', async () => {
		await armFlag(null);
		env['CACHE_STATS_MAX_BUFFER'] = 10;
		mockRedis.xlen.mockResolvedValue(50);

		await enforceCacheStatsBudget();

		expect(cacheStatsActive()).toBe(false);
		expect(mockRedis.set).toHaveBeenCalledWith('scalabus:stats:enabled', '0');

		expect(mockRedis.set).toHaveBeenCalledWith(
			'scalabus:stats:killed_reason',
			expect.stringContaining('buffer 50 > 10'),
		);
	});

	it('auto-disables when the table outgrows the byte budget', async () => {
		await armFlag(null);
		env['CACHE_STATS_MAX_BYTES'] = '1kb';
		mockRedis.xlen.mockResolvedValue(0);

		mockDb.raw
			.mockResolvedValueOnce({ rows: [{ has: true }] })
			.mockResolvedValueOnce({ rows: [{ bytes: 5000 }] });

		await enforceCacheStatsBudget();

		expect(cacheStatsActive()).toBe(false);

		expect(mockRedis.set).toHaveBeenCalledWith(
			'scalabus:stats:killed_reason',
			expect.stringContaining('table 5000B'),
		);

		// Timescale present → size comes from hypertable_size (sums the chunks), not the
		// parent-only pg_total_relation_size.
		expect(mockDb.raw).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining('pg_extension'),
		);

		expect(mockDb.raw).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining('hypertable_size'),
		);
	});

	it('reads the size from pg_total_relation_size on plain postgres', async () => {
		// isTimescale caches per module; a fresh import gives a null cache so the
		// non-Timescale branch runs regardless of the Timescale test above.
		vi.resetModules();
		const fresh = await import('./cache-events.js');

		mockRedis.get.mockResolvedValueOnce(null);
		await fresh.refreshCacheStatsFlag();

		env['CACHE_STATS_MAX_BYTES'] = '1kb';
		mockRedis.xlen.mockResolvedValue(0);

		mockDb.raw
			.mockResolvedValueOnce({ rows: [{ has: false }] })
			.mockResolvedValueOnce({ rows: [{ bytes: 5000 }] });

		await fresh.enforceCacheStatsBudget();

		expect(mockDb.raw).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining('pg_total_relation_size'),
		);
	});

	it('skips the size check on a non-postgres client', async () => {
		await armFlag(null);
		env['CACHE_STATS_MAX_BYTES'] = '1kb';
		mockRedis.xlen.mockResolvedValue(0);
		mockDb.client = { config: { client: 'sqlite3' } };

		await enforceCacheStatsBudget();

		expect(cacheStatsActive()).toBe(true);
	});

	it('treats a table-size query error as zero bytes', async () => {
		await armFlag(null);
		env['CACHE_STATS_MAX_BYTES'] = '1kb';
		mockRedis.xlen.mockResolvedValue(0);
		mockDb.raw.mockRejectedValue(new Error('boom'));

		await enforceCacheStatsBudget();

		expect(cacheStatsActive()).toBe(true);
	});

	it('does nothing when already disabled (one-way latch)', async () => {
		await setCacheStatsEnabled(false);
		mockRedis.xlen.mockClear();

		await enforceCacheStatsBudget();

		expect(mockRedis.xlen).not.toHaveBeenCalled();
	});
});

describe('setCacheStatsEnabled', () => {
	it('enabling flips the flag on and clears the reason', async () => {
		await setCacheStatsEnabled(true);

		expect(mockRedis.set).toHaveBeenCalledWith('scalabus:stats:enabled', '1');
		expect(mockRedis.del).toHaveBeenCalledWith('scalabus:stats:killed_reason');
		expect(cacheStatsActive()).toBe(true);
	});

	it('publishes the toggle on the bus so other nodes flip at once', async () => {
		await setCacheStatsEnabled(true);

		expect(mockBus.publish).toHaveBeenCalledWith('cacheStatsToggled', {
			enabled: true,
		});

		await setCacheStatsEnabled(false, 'autokill: x');

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
	it('reports the reason and buffer length when configured', async () => {
		mockRedis.get.mockResolvedValue('autokill: buffer 50 > 10');
		mockRedis.xlen.mockResolvedValue(7);

		await expect(getCacheStatsState()).resolves.toMatchObject({
			configured: true,
			killedReason: 'autokill: buffer 50 > 10',
			bufferLength: 7,
		});
	});

	it('reports nothing when not configured', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);

		await expect(getCacheStatsState()).resolves.toEqual({
			configured: false,
			enabled: false,
			killedReason: null,
			bufferLength: 0,
			droppedEvents: 0,
		});
	});
});

describe('truncateCacheEvents', () => {
	it('truncates the fact, dimension, and anomaly tables', async () => {
		await truncateCacheEvents();

		expect(mockDb).toHaveBeenCalledWith('directus_cache_events');
		expect(mockDb).toHaveBeenCalledWith('directus_cache_descriptors');
		expect(mockDb).toHaveBeenCalledWith('directus_cache_anomalies');
		expect(builder.truncate).toHaveBeenCalledTimes(3);
	});

	it('also clears the stream buffer and the throttle/tombstone keys', async () => {
		mockRedis.scan.mockImplementation((_cursor: string, _match: string, pattern: string) => {
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
		expect(mockRedis.scan).toHaveBeenCalledWith('0', 'MATCH', 'scalabus:stats:anom:*', 'COUNT', 100);
		expect(mockRedis.scan).toHaveBeenCalledWith('0', 'MATCH', 'scalabus:stats:tomb:*', 'COUNT', 100);

		expect(mockRedis.unlink).toHaveBeenCalledWith(
			'scalabus:stats:anom:missing_scope:h1',
		);
	});

	it('skips the Redis reset when Redis is not configured', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		mockRedis.del.mockClear();

		await truncateCacheEvents();

		expect(builder.truncate).toHaveBeenCalledTimes(3);
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
		});

		expect(mockRedis.call).not.toHaveBeenCalled();
	});
});

describe('listCacheEntries', () => {
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
				query: '{"limit":5}',
				url: '/items/a?limit=5',
				bytes: '42',
				last_filled: new Date(1000).toISOString(),
				hits: '3',
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
				redisKey: '/items/a?limit=5:u1',
				coarse: true,
				method: 'GET',
				path: '/items/a',
				collection: 'a',
				user: { id: 'u1', email: 'alice@corp.io' },
				query: '{"limit":5}',
				url: '/items/a?limit=5',
				size: 42,
				hits: 3,
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
				redisKey: '',
				coarse: false,
				method: 'GET',
				path: '/items/b',
				collection: null,
				user: null,
				query: '{}',
				url: '',
				size: 0,
				hits: 0,
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

	it('returns an empty array when not configured', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		expect(await listCacheEntries()).toEqual([]);
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
				query: '{"limit":5}',
				url: '/items/big?limit=5',
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
				query: '{"limit":5}',
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

describe('reapCacheDescriptors', () => {
	it('deletes orphaned descriptors past the reap window', async () => {
		const now = 1_700_000_000_000;
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
		deleteCount = 3;

		const reaped = await reapCacheDescriptors();

		// Two deletes — filled orphans + never-filled locators — each returns deleteCount.
		expect(reaped).toBe(6);
		expect(mockDb).toHaveBeenCalledWith('directus_cache_descriptors');

		// Filled: stale past the 90d cutoff (a sign flip would hit live rows)...
		expect(builder.where).toHaveBeenCalledWith(
			'last_filled',
			'<',
			new Date(now - 7_776_000_000),
		);

		// ...AND with no event still on file. Locators (NULL last_filled) reap only when
		// no event AND no anomaly still references them.
		expect(builder.whereNull).toHaveBeenCalledWith('last_filled');
		expect(builder.whereNotIn).toHaveBeenCalledWith('cache_key', expect.anything());
		expect(builder.delete).toHaveBeenCalledTimes(2);

		nowSpy.mockRestore();
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
	it('drops events past the cap while a flush is in flight and counts them', async () => {
		await armFlag(null);

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
		for (let i = 0; i < 2100; i += 1) {
			await queueCacheHit({ cacheKey: 'k', ageMs: 1, ttlMs: 1, durationMs: 1 });
		}

		expect((await getCacheStatsState()).droppedEvents).toBeGreaterThan(0);

		releaseFlush();
	});
});
