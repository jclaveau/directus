import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
	cacheStatsActive,
	cacheStatsConfigured,
	captureCacheDescriptor,
	captureCacheHit,
	captureCacheMiss,
	enforceCacheStatsBudget,
	evictCacheEntriesForPath,
	evictCacheEntry,
	flushCacheEvents,
	getCacheStatsState,
	listCacheEntries,
	readCacheMissGap,
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

let xrangeBatch: [string, string[]][];

let mockRedis: {
	call: Mock;
	xlen: Mock;
	get: Mock;
	set: Mock;
	del: Mock;
};

let builder: any;
let queryRows: any[];
let pluckResult: string[];
let deleteCount: number;

let mockDb: any;

beforeEach(() => {
	xrangeBatch = [];
	queryRows = [];
	pluckResult = [];
	deleteCount = 0;

	mockRedis = {
		// Stream ops go through .call(); XRANGE returns the staged batch.
		call: vi.fn(async (command: string) => {
			if (command === 'XRANGE') {
				return xrangeBatch;
			}

			return null;
		}),
		xlen: vi.fn(),
		get: vi.fn().mockResolvedValue(null),
		set: vi.fn(),
		del: vi.fn(),
	};

	// Chainable knex stub: chain methods return the builder; terminals resolve the
	// staged result. Thenable so `await db(t).….select(…)` resolves queryRows.
	builder = {
		insert: vi.fn(() => builder),
		onConflict: vi.fn(() => builder),
		merge: vi.fn(() => Promise.resolve()),
		truncate: vi.fn(() => Promise.resolve()),
		join: vi.fn(() => builder),
		leftJoin: vi.fn(() => builder),
		where: vi.fn(() => builder),
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

afterEach(() => {
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

describe('captureCacheHit', () => {
	it('appends a hit keyed by the cache key', async () => {
		await armFlag(null);

		await captureCacheHit({
			cacheKey: 'k1',
			ageMs: 5000,
			ttlMs: 300000,
			durationMs: 12,
		});

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

		await captureCacheHit({
			cacheKey: 'k1',
			ageMs: 1,
			ttlMs: null,
			durationMs: null,
		});

		expect(fieldAfter(mockRedis.call.mock.calls[0]!, 'ttlMs')).toBe('');
	});

	it('does nothing when capture is disabled', async () => {
		await setCacheStatsEnabled(false);
		mockRedis.call.mockClear();

		await captureCacheHit({
			cacheKey: 'k1',
			ageMs: 1,
			ttlMs: null,
			durationMs: null,
		});

		expect(mockRedis.call).not.toHaveBeenCalled();
	});
});

describe('captureCacheMiss', () => {
	it('appends a miss with a real gap', async () => {
		await armFlag(null);

		await captureCacheMiss({ cacheKey: 'k1', gapMs: 2000, ttlMs: 300000 });

		const call = mockRedis.call.mock.calls[0]!;
		expect(fieldAfter(call, 'kind')).toBe('m');
		expect(fieldAfter(call, 'cacheKey')).toBe('k1');
		expect(fieldAfter(call, 'gapMs')).toBe('2000');
	});

	it('serialises a cold miss (null gap) as an empty string', async () => {
		await armFlag(null);

		await captureCacheMiss({ cacheKey: 'k1', gapMs: null, ttlMs: null });

		const call = mockRedis.call.mock.calls[0]!;
		expect(fieldAfter(call, 'gapMs')).toBe('');
		expect(fieldAfter(call, 'ttlMs')).toBe('');
	});
});

describe('captureCacheDescriptor', () => {
	it('appends the full descriptor keyed by the cache key', async () => {
		await armFlag(null);

		await captureCacheDescriptor({
			cacheKey: 'k1',
			method: 'GET',
			path: '/items/articles',
			collection: 'articles',
			userId: 'user-1',
			query: '{"limit":5}',
			url: '/items/articles?limit=5',
			bytes: 42,
			fillMs: 240,
		});

		const call = mockRedis.call.mock.calls[0]!;
		expect(fieldAfter(call, 'kind')).toBe('d');
		expect(fieldAfter(call, 'cacheKey')).toBe('k1');
		expect(fieldAfter(call, 'path')).toBe('/items/articles');
		expect(fieldAfter(call, 'userId')).toBe('user-1');
		expect(fieldAfter(call, 'bytes')).toBe('42');
	});

	it('serialises a null collection and user as empty strings', async () => {
		await armFlag(null);

		await captureCacheDescriptor({
			cacheKey: 'k2',
			method: 'GET',
			path: '/server/info',
			collection: null,
			userId: null,
			query: '{}',
			url: '',
			bytes: 0,
			fillMs: 0,
		});

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

describe('flushCacheEvents', () => {
	it('demuxes hits/misses to events and descriptors to the dimension', async () => {
		xrangeBatch = [
			streamEntry('1-0', {
				kind: 'h', cacheKey: 'k1', ageMs: '5000', ttlMs: '300000',
				durationMs: '12', ts: '1000',
			}),
			streamEntry('2-0', {
				kind: 'm', cacheKey: 'k2', gapMs: '2000', ttlMs: '300000', ts: '2000',
			}),
			streamEntry('3-0', {
				kind: 'd', cacheKey: 'k1', method: 'GET', path: '/items/a',
				collection: 'a', userId: 'u1', query: '{}', url: '/items/a', bytes: '42',
				fillMs: '240', ts: '3000',
			}),
		];

		const drained = await flushCacheEvents();

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

	it('returns 0 without draining when not configured', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);

		expect(await flushCacheEvents()).toBe(0);
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
			if (command === 'XRANGE') {
				call += 1;
				return call === 1
					? fullBatch
					: [];
			}

			return null;
		});

		expect(await flushCacheEvents()).toBe(500);
		expect(mockDb.batchInsert).toHaveBeenCalledTimes(1);
	});

	it('stores a null collection and user on the descriptor', async () => {
		xrangeBatch = [
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

		await flushCacheEvents();

		expect(builder.insert).toHaveBeenCalledWith([
			expect.objectContaining({ collection: null, user_id: null }),
		]);
	});

	it('yields the flush while the pool has queued acquirers', async () => {
		mockDb.client = {
			config: { client: 'pg' },
			pool: { numPendingAcquires: () => 3 },
		};

		xrangeBatch = [
			streamEntry('1-0', { kind: 'h', cacheKey: 'k', ageMs: '1', ts: '1' }),
		];

		// Saturated pool → skip this tick, leave the batch buffered (no DB/read).
		expect(await flushCacheEvents()).toBe(0);
		expect(mockRedis.call).not.toHaveBeenCalled();
		expect(mockDb.batchInsert).not.toHaveBeenCalled();
	});

	it('drops a poison batch (still XDELs) instead of wedging when the insert fails', async () => {
		mockDb.batchInsert.mockRejectedValueOnce(new Error('value too long'));

		xrangeBatch = [
			streamEntry('1-0', { kind: 'h', cacheKey: 'k', ageMs: '1', ttlMs: '1', ts: '1' }),
		];

		// A deterministically-unpersistable batch must not reject the flush...
		await expect(flushCacheEvents()).resolves.toBe(1);

		// ...and it's still XDEL'd, so it can't be re-read from the stream head every
		// subsequent tick (the wedge this guards against).
		expect(mockDb.batchInsert).toHaveBeenCalledTimes(1);
		expect(mockRedis.call).toHaveBeenCalledWith('XDEL', STREAM, '1-0');
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
		});
	});
});

describe('truncateCacheEvents', () => {
	it('truncates both the fact and the dimension tables', async () => {
		await truncateCacheEvents();

		expect(mockDb).toHaveBeenCalledWith('directus_cache_events');
		expect(mockDb).toHaveBeenCalledWith('directus_cache_descriptors');
		expect(builder.truncate).toHaveBeenCalledTimes(2);
	});
});

describe('capture is gated by the runtime flag', () => {
	it('captureCacheMiss does nothing when disabled', async () => {
		await setCacheStatsEnabled(false);
		mockRedis.call.mockClear();

		await captureCacheMiss({ cacheKey: 'k1', gapMs: null, ttlMs: null });

		expect(mockRedis.call).not.toHaveBeenCalled();
	});

	it('captureCacheDescriptor does nothing when disabled', async () => {
		await setCacheStatsEnabled(false);
		mockRedis.call.mockClear();

		await captureCacheDescriptor({
			cacheKey: 'k1',
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

		expect(entries).toEqual([
			{
				key: 'k1',
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
		expect(builder.pluck).toHaveBeenCalledWith('cache_key');
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

describe('reapCacheDescriptors', () => {
	it('deletes orphaned descriptors and returns the count', async () => {
		deleteCount = 3;

		const reaped = await reapCacheDescriptors();

		expect(reaped).toBe(3);
		expect(mockDb).toHaveBeenCalledWith('directus_cache_descriptors');
		expect(builder.whereNotIn).toHaveBeenCalled();
		expect(builder.delete).toHaveBeenCalled();
	});

	it('returns 0 when not configured', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		expect(await reapCacheDescriptors()).toBe(0);
	});
});

describe('reapCacheEvents', () => {
	it('prunes fact rows past the retention window', async () => {
		deleteCount = 7;

		const reaped = await reapCacheEvents();

		expect(reaped).toBe(7);
		expect(mockDb).toHaveBeenCalledWith('directus_cache_events');
		expect(builder.where).toHaveBeenCalledWith('time', '<', expect.any(Date));
		expect(builder.delete).toHaveBeenCalled();
	});

	it('returns 0 when not configured', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		expect(await reapCacheEvents()).toBe(0);
	});
});
