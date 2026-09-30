import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCache } from '../cache.js';
import { useLogger } from '../logger/index.js';
import { scopedCachePurgeEnabled } from './config.js';
import { scopedCacheFillPaused } from './fill-pause.js';
import { reapScopedCacheIndex } from './purge.js';
import {
	requestScopedCacheIndexReap,
	runScopedCacheIndexReap,
} from './reap-requests.js';
import { useScopedCacheStore } from './store.js';

vi.mock('../cache.js', () => ({ getCache: vi.fn() }));
vi.mock('../logger/index.js', () => ({ useLogger: vi.fn() }));
vi.mock('./config.js', () => ({ scopedCachePurgeEnabled: vi.fn() }));
vi.mock('./fill-pause.js', () => ({ scopedCacheFillPaused: vi.fn() }));
vi.mock('./purge.js', () => ({ reapScopedCacheIndex: vi.fn() }));
vi.mock('./store.js', () => ({ useScopedCacheStore: vi.fn() }));

const lockCache = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
const indexKeysComplete = vi.fn();
const warn = vi.fn();

beforeEach(() => {
	vi.useFakeTimers();
	vi.mocked(scopedCachePurgeEnabled).mockReturnValue(true);
	vi.mocked(getCache).mockReturnValue({ lockCache } as any);
	vi.mocked(useLogger).mockReturnValue({ warn } as any);

	vi.mocked(useScopedCacheStore)
		.mockReturnValue({ indexKeysComplete } as any);

	lockCache.get.mockResolvedValue(undefined);
	lockCache.set.mockResolvedValue(true);
	indexKeysComplete.mockResolvedValue(false);
});

afterEach(() => {
	vi.useRealTimers();
	vi.resetAllMocks();
});

describe('requestScopedCacheIndexReap', () => {
	it(oneLine`
		answers a burst of requests with one reap, once the burst is over
	`, async () => {
		const requested = [
			requestScopedCacheIndexReap(),
			requestScopedCacheIndexReap(),
			requestScopedCacheIndexReap(),
		];

		await vi.advanceTimersByTimeAsync(999);

		expect(reapScopedCacheIndex).not.toHaveBeenCalled();

		await vi.waitFor(() => expect(lockCache.delete).toHaveBeenCalled());
		await Promise.all(requested);

		expect(reapScopedCacheIndex).toHaveBeenCalledOnce();

		expect(lockCache.set).toHaveBeenCalledExactlyOnceWith(
			'scoped-cache-index:reap',
			true,
			120_000,
		);

		expect(lockCache.delete)
		.toHaveBeenCalledExactlyOnceWith('scoped-cache-index:reap');
	});

	it(oneLine`
		reaps once more for a request landing during the pass — the pass may have
		read the index before the drop that asked
	`, async () => {
		vi.mocked(reapScopedCacheIndex).mockImplementationOnce(async () => {
			void requestScopedCacheIndexReap();

			return 0;
		});

		const requested = requestScopedCacheIndexReap();

		await vi.waitFor(() => {
			expect(lockCache.delete).toHaveBeenCalledTimes(2);
		}, { timeout: 5_000 });

		await requested;

		expect(reapScopedCacheIndex).toHaveBeenCalledTimes(2);
	});

	it('reaps nothing while the index-key sets are marked complete', async () => {
		indexKeysComplete.mockResolvedValue(true);

		const requested = requestScopedCacheIndexReap();

		await vi.advanceTimersByTimeAsync(1_000);
		await vi.waitFor(() => expect(indexKeysComplete).toHaveBeenCalled());
		await requested;

		expect(reapScopedCacheIndex).not.toHaveBeenCalled();
		expect(lockCache.get).not.toHaveBeenCalled();
	});

	it(oneLine`
		waits for a pass holding the lock, then reaps if that pass marked nothing —
		it may have read the index before the drop
	`, async () => {
		lockCache.get.mockResolvedValueOnce(true);

		const requested = requestScopedCacheIndexReap();

		await vi.advanceTimersByTimeAsync(1_000);
		await vi.waitFor(() => expect(lockCache.get).toHaveBeenCalled());

		expect(reapScopedCacheIndex).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(5_000);
		await vi.waitFor(() => expect(lockCache.delete).toHaveBeenCalled());

		await requested;

		expect(reapScopedCacheIndex).toHaveBeenCalledOnce();
		expect(lockCache.get).toHaveBeenCalledTimes(2);
	});

	it(oneLine`
		logs a failed pass and resolves — the caller is a flush or a boot, and
		nothing awaits it
	`, async () => {
		vi.mocked(reapScopedCacheIndex)
			.mockRejectedValueOnce(new Error('Connection is closed.'));

		const requested = requestScopedCacheIndexReap();

		await vi.advanceTimersByTimeAsync(1_000);
		await vi.waitFor(() => expect(warn).toHaveBeenCalled());
		await expect(requested).resolves.toBeUndefined();

		expect(warn).toHaveBeenCalledExactlyOnceWith(
			new Error('Connection is closed.'),
			'[scoped-cache] requested index reap failed: Error: Connection is closed.',
		);

		expect(lockCache.delete)
		.toHaveBeenCalledExactlyOnceWith('scoped-cache-index:reap');
	});

	it(oneLine`
		reaps nothing while the fill pause runs — its mark is refused, and the
		pause's end asks for the pass
	`, async () => {
		vi.mocked(scopedCacheFillPaused).mockReturnValue(true);

		const requested = requestScopedCacheIndexReap();

		await vi.advanceTimersByTimeAsync(1_000);
		await requested;

		expect(reapScopedCacheIndex).not.toHaveBeenCalled();
		expect(lockCache.get).not.toHaveBeenCalled();
	});

	it(oneLine`
		stops waiting for the lock once the fill pause runs — a pass then would be
		refused its mark
	`, async () => {
		vi.mocked(scopedCacheFillPaused)
			.mockReturnValueOnce(false)
			.mockReturnValue(true);

		lockCache.get.mockResolvedValueOnce(true);

		const requested = requestScopedCacheIndexReap();

		await vi.advanceTimersByTimeAsync(1_000);
		await vi.waitFor(() => expect(lockCache.get).toHaveBeenCalled());
		await vi.advanceTimersByTimeAsync(5_000);
		await requested;

		expect(reapScopedCacheIndex).not.toHaveBeenCalled();
		expect(lockCache.get).toHaveBeenCalledOnce();
	});

	it(oneLine`
		reaps once the fill pause ended — the request its end sends
	`, async () => {
		vi.mocked(scopedCacheFillPaused).mockReturnValue(false);

		const requested = requestScopedCacheIndexReap();

		await vi.advanceTimersByTimeAsync(1_000);
		await vi.waitFor(() => expect(lockCache.delete).toHaveBeenCalled());
		await requested;

		expect(reapScopedCacheIndex).toHaveBeenCalledOnce();
	});

	it('asks for nothing with scoped purging off', async () => {
		vi.mocked(scopedCachePurgeEnabled).mockReturnValue(false);

		await requestScopedCacheIndexReap();

		expect(indexKeysComplete).not.toHaveBeenCalled();
	});
});

describe('runScopedCacheIndexReap', () => {
	it('reaps nothing while another pass holds the lock', async () => {
		lockCache.get.mockResolvedValueOnce(true);

		expect(await runScopedCacheIndexReap()).toBe(false);
		expect(reapScopedCacheIndex).not.toHaveBeenCalled();
		expect(lockCache.set).not.toHaveBeenCalled();
	});

	it('renews the lock while the pass runs', async () => {
		vi.mocked(reapScopedCacheIndex).mockImplementationOnce(async () => {
			await vi.advanceTimersByTimeAsync(30_000);

			return 0;
		});

		expect(await runScopedCacheIndexReap()).toBe(true);

		expect(lockCache.set.mock.calls).toEqual([
			['scoped-cache-index:reap', true, 120_000],
			['scoped-cache-index:reap', true, 120_000],
		]);
	});
});
