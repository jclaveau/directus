import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBus } from '../bus/index.js';
import { recordScopedCacheBuild } from '../cache-build-identity.js';
import { useLogger } from '../logger/index.js';
import { redisConfigAvailable, useCacheRedis } from '../redis/index.js';
import { listPendingScopedCachePurges } from '../scoped-cache-pending-purges.js';
import { scopedCacheFillPaused } from './fill-pause.js';
import { startScopedCachePurgeRecovery } from './purge.js';
import { requestScopedCacheIndexReap } from './reap-requests.js';

const env = vi.hoisted(() => {
	return {
		CACHE_AUTO_PURGE_MODE: 'scoped',
		CACHE_STORE: 'redis',
		CACHE_NAMESPACE: 'ns',
	} as Record<string, any>;
});

vi.mock('@directus/env', () => ({ useEnv: () => env }));
vi.mock('../redis/index.js');
vi.mock('../bus/index.js', () => ({ useBus: vi.fn() }));
vi.mock('../logger/index.js', () => ({ useLogger: vi.fn() }));
vi.mock('../cache.js', () => ({ getCache: vi.fn() }));
vi.mock('../emitter.js', () => ({ default: { emitAction: vi.fn() } }));
vi.mock('./fill-pause.js', () => ({ scopedCacheFillPaused: vi.fn() }));

vi.mock('./reap-requests.js', () => {
	return { requestScopedCacheIndexReap: vi.fn() };
});

vi.mock('../cache-build-identity.js', () => {
	return { recordScopedCacheBuild: vi.fn() };
});

vi.mock('../cache-events.js', () => {
	return {
		queueCacheAnomaly: vi.fn(),
		queueCachePurge: vi.fn(),
		readCacheDescriptorForRedisKey: vi.fn(),
	};
});

vi.mock('../scoped-cache-pending-purges.js', () => {
	return {
		clearPendingScopedCachePurges: vi.fn(),
		countFailedScopedCachePurgeRetry: vi.fn(),
		listPendingScopedCachePurges: vi.fn(),
		scopedCachePurgeRetryMaxFingerprints: () => 100,
		recordPendingScopedCachePurge: vi.fn(),
	};
});

const redisOn = vi.fn();
const busSubscribe = vi.fn();
const warn = vi.fn();

beforeEach(() => {
	vi.mocked(redisConfigAvailable).mockReturnValue(true);
	vi.mocked(useCacheRedis).mockReturnValue({ on: redisOn } as any);
	vi.mocked(useBus).mockReturnValue({ subscribe: busSubscribe } as any);

	vi.mocked(useLogger)
		.mockReturnValue({ debug: vi.fn(), info: vi.fn(), warn } as any);

	vi.mocked(listPendingScopedCachePurges).mockResolvedValue([]);
});

afterEach(() => {
	vi.resetAllMocks();
});

describe('startScopedCachePurgeRecovery on a reconnect', () => {
	it(oneLine`
		records the build on the first ready only — a process of the build before
		reconnecting through a deploy would record its build over the new one
	`, async () => {
		vi.mocked(scopedCacheFillPaused).mockReturnValue(false);

		startScopedCachePurgeRecovery();

		redisOn.mock.calls[0]![1]();

		await vi.waitFor(() => {
			expect(requestScopedCacheIndexReap).toHaveBeenCalledOnce();
		});

		redisOn.mock.calls[0]![1]();

		await vi.waitFor(() => {
			expect(requestScopedCacheIndexReap).toHaveBeenCalledTimes(2);
		});

		expect(recordScopedCacheBuild).toHaveBeenCalledOnce();
	});

	it(oneLine`
		records the build again on a later ready while fills stay paused — the
		record Redis refused leaves them paused until one gets through
	`, async () => {
		vi.mocked(scopedCacheFillPaused).mockReturnValue(true);

		startScopedCachePurgeRecovery();

		redisOn.mock.calls[0]![1]();

		await vi.waitFor(() => {
			expect(requestScopedCacheIndexReap).toHaveBeenCalledOnce();
		});

		redisOn.mock.calls[0]![1]();

		await vi.waitFor(() => {
			expect(requestScopedCacheIndexReap).toHaveBeenCalledTimes(2);
		});

		expect(recordScopedCacheBuild).toHaveBeenCalledTimes(2);
	});
});

describe('startScopedCachePurgeRecovery on a flush elsewhere', () => {
	it(oneLine`
		asks for a reap when another process flushed the response cache — a
		one-shot command exits before its own reap runs
	`, async () => {
		startScopedCachePurgeRecovery();

		redisOn.mock.calls[0]![1]();

		await vi.waitFor(() => {
			expect(busSubscribe)
				.toHaveBeenCalledExactlyOnceWith('cacheCleared', expect.any(Function));
		});

		vi.mocked(requestScopedCacheIndexReap).mockClear();

		busSubscribe.mock.calls[0]![1]({ targets: ['response', 'system'] });

		expect(requestScopedCacheIndexReap).toHaveBeenCalledOnce();
	});

	it('asks for no reap on a flush that left the response cache', async () => {
		startScopedCachePurgeRecovery();

		redisOn.mock.calls[0]![1]();

		await vi.waitFor(() => expect(busSubscribe).toHaveBeenCalledOnce());

		vi.mocked(requestScopedCacheIndexReap).mockClear();

		busSubscribe.mock.calls[0]![1]({ targets: ['locks'] });

		expect(requestScopedCacheIndexReap).not.toHaveBeenCalled();
	});

	it('listens once, whatever the reconnects', async () => {
		startScopedCachePurgeRecovery();

		redisOn.mock.calls[0]![1]();
		redisOn.mock.calls[0]![1]();

		await vi.waitFor(() => {
			expect(requestScopedCacheIndexReap).toHaveBeenCalledTimes(2);
		});

		expect(busSubscribe).toHaveBeenCalledOnce();
	});

	it('logs a bus it cannot listen on rather than leave it unhandled', async () => {
		vi.mocked(useBus).mockImplementation(() => {
			throw new Error('Connection is closed.');
		});

		startScopedCachePurgeRecovery();

		redisOn.mock.calls[0]![1]();

		await vi.waitFor(() => {
			expect(warn).toHaveBeenCalledWith(
				new Error('Connection is closed.'),
				oneLine`
					[scoped-cache] could not hear the flushes of other processes:
					Error: Connection is closed.
				`,
			);
		});
	});
});
