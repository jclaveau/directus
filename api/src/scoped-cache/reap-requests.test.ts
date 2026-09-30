import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCache } from '../cache.js';
import { cacheEntryRawKeyOf } from '../cache-drop.js';
import { holdCacheLock, releaseCacheLock } from '../cache-lock.js';
import { useLogger } from '../logger/index.js';
import { scopedCachePurgeEnabled } from './config.js';
import { scopedCacheFillPaused } from './fill-pause.js';
import { reapScopedCacheIndex } from './purge.js';
import {
	requestScopedCacheIndexReap,
	runScopedCacheIndexReap,
} from './reap-requests.js';
import { useScopedCacheStore } from './store.js';

vi.mock('node:crypto', () => ({ randomUUID: () => 'pass-1' }));
vi.mock('../cache.js', () => ({ getCache: vi.fn() }));
vi.mock('../cache-drop.js', () => ({ cacheEntryRawKeyOf: vi.fn() }));

vi.mock('../cache-lock.js', () => {
	return { holdCacheLock: vi.fn(), releaseCacheLock: vi.fn() };
});

vi.mock('../logger/index.js', () => ({ useLogger: vi.fn() }));
vi.mock('./config.js', () => ({ scopedCachePurgeEnabled: vi.fn() }));
vi.mock('./fill-pause.js', () => ({ scopedCacheFillPaused: vi.fn() }));
vi.mock('./purge.js', () => ({ reapScopedCacheIndex: vi.fn() }));
vi.mock('./store.js', () => ({ useScopedCacheStore: vi.fn() }));

const indexKeysComplete = vi.fn();
const warn = vi.fn();

beforeEach(() => {
	vi.useFakeTimers();
	vi.mocked(scopedCachePurgeEnabled).mockReturnValue(true);
	vi.mocked(getCache).mockReturnValue({ lockCache: {} } as any);

	vi.mocked(cacheEntryRawKeyOf).mockReturnValue((key) => {
		return `scalabus_lock::scalabus_lock:${key}`;
	});

	vi.mocked(useLogger).mockReturnValue({ warn } as any);

	vi.mocked(useScopedCacheStore)
		.mockReturnValue({ indexKeysComplete } as any);

	vi.mocked(holdCacheLock).mockResolvedValue(true);
	vi.mocked(releaseCacheLock).mockResolvedValue(undefined);
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

		await vi.waitFor(() => expect(releaseCacheLock).toHaveBeenCalled());
		await Promise.all(requested);

		expect(reapScopedCacheIndex).toHaveBeenCalledOnce();

		expect(holdCacheLock).toHaveBeenCalledExactlyOnceWith(
			{},
			'scoped-cache-index:reap',
			'pass-1',
			120_000,
		);

		expect(releaseCacheLock).toHaveBeenCalledExactlyOnceWith(
			{},
			'scoped-cache-index:reap',
			'pass-1',
		);
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
			expect(releaseCacheLock).toHaveBeenCalledTimes(2);
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
		expect(holdCacheLock).not.toHaveBeenCalled();
	});

	it(oneLine`
		waits for a pass holding the lock, then reaps if that pass marked nothing —
		it may have read the index before the drop
	`, async () => {
		vi.mocked(holdCacheLock).mockResolvedValueOnce(false);

		const requested = requestScopedCacheIndexReap();

		await vi.advanceTimersByTimeAsync(1_000);
		await vi.waitFor(() => expect(holdCacheLock).toHaveBeenCalled());

		expect(reapScopedCacheIndex).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(5_000);
		await vi.waitFor(() => expect(releaseCacheLock).toHaveBeenCalled());

		await requested;

		expect(reapScopedCacheIndex).toHaveBeenCalledOnce();
		expect(holdCacheLock).toHaveBeenCalledTimes(2);
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

		expect(releaseCacheLock).toHaveBeenCalledExactlyOnceWith(
			{},
			'scoped-cache-index:reap',
			'pass-1',
		);
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
		expect(holdCacheLock).not.toHaveBeenCalled();
	});

	it(oneLine`
		stops waiting for the lock once the fill pause runs — a pass then would be
		refused its mark
	`, async () => {
		vi.mocked(scopedCacheFillPaused)
			.mockReturnValueOnce(false)
			.mockReturnValue(true);

		vi.mocked(holdCacheLock).mockResolvedValueOnce(false);

		const requested = requestScopedCacheIndexReap();

		await vi.advanceTimersByTimeAsync(1_000);
		await vi.waitFor(() => expect(holdCacheLock).toHaveBeenCalled());
		await vi.advanceTimersByTimeAsync(5_000);
		await requested;

		expect(reapScopedCacheIndex).not.toHaveBeenCalled();
		expect(holdCacheLock).toHaveBeenCalledOnce();
	});

	it(oneLine`
		reaps once the fill pause ended — the request its end sends
	`, async () => {
		vi.mocked(scopedCacheFillPaused).mockReturnValue(false);

		const requested = requestScopedCacheIndexReap();

		await vi.advanceTimersByTimeAsync(1_000);
		await vi.waitFor(() => expect(releaseCacheLock).toHaveBeenCalled());
		await requested;

		expect(reapScopedCacheIndex).toHaveBeenCalledOnce();
	});

	it(oneLine`
		reaps once for a forced request while the index-key sets are marked
		complete — a drop keeps the names of the sets it unlinked, and only a pass
		releases them
	`, async () => {
		indexKeysComplete.mockResolvedValue(true);

		const requested = requestScopedCacheIndexReap({ forcePass: true });

		await vi.advanceTimersByTimeAsync(1_000);
		await vi.waitFor(() => expect(releaseCacheLock).toHaveBeenCalled());
		await requested;

		expect(reapScopedCacheIndex).toHaveBeenCalledOnce();
	});

	it('forces the waiting pass a forced request joins', async () => {
		indexKeysComplete.mockResolvedValue(true);

		const requested = [
			requestScopedCacheIndexReap(),
			requestScopedCacheIndexReap({ forcePass: true }),
		];

		await vi.advanceTimersByTimeAsync(1_000);
		await vi.waitFor(() => expect(releaseCacheLock).toHaveBeenCalled());
		await Promise.all(requested);

		expect(reapScopedCacheIndex).toHaveBeenCalledOnce();
	});

	it(oneLine`
		forces one pass only — a request after it reads the marker again
	`, async () => {
		indexKeysComplete.mockResolvedValue(true);

		const forced = requestScopedCacheIndexReap({ forcePass: true });

		await vi.advanceTimersByTimeAsync(1_000);
		await vi.waitFor(() => expect(releaseCacheLock).toHaveBeenCalled());
		await forced;

		const unforced = requestScopedCacheIndexReap();

		await vi.advanceTimersByTimeAsync(1_000);
		await unforced;

		expect(reapScopedCacheIndex).toHaveBeenCalledOnce();
	});

	it(oneLine`
		reaps nothing for a forced request while the fill pause runs — the pause's
		end asks for the pass
	`, async () => {
		vi.mocked(scopedCacheFillPaused).mockReturnValue(true);

		const requested = requestScopedCacheIndexReap({ forcePass: true });

		await vi.advanceTimersByTimeAsync(1_000);
		await requested;

		expect(reapScopedCacheIndex).not.toHaveBeenCalled();
		expect(holdCacheLock).not.toHaveBeenCalled();
	});

	it(oneLine`
		reaps at once for a request skipping the debounce — the clear awaiting it
		answers once the pass is over
	`, async () => {
		await requestScopedCacheIndexReap({ skipDebounce: true });

		expect(reapScopedCacheIndex).toHaveBeenCalledOnce();
	});

	it(oneLine`
		ends the debounce of the waiting pass a request skipping it joins, and
		reaps once
	`, async () => {
		indexKeysComplete.mockResolvedValue(true);

		const requested = [
			requestScopedCacheIndexReap({ forcePass: true }),
			requestScopedCacheIndexReap({ forcePass: true, skipDebounce: true }),
		];

		await Promise.all(requested);

		expect(reapScopedCacheIndex).toHaveBeenCalledOnce();
	});

	it(oneLine`
		reaps again at once for a request skipping the debounce during a pass — the
		pass may have read the index before the drop that asked
	`, async () => {
		vi.mocked(reapScopedCacheIndex).mockImplementationOnce(async () => {
			void requestScopedCacheIndexReap({ skipDebounce: true });

			return 0;
		});

		await requestScopedCacheIndexReap({ skipDebounce: true });

		expect(reapScopedCacheIndex).toHaveBeenCalledTimes(2);
	});

	it('asks for nothing with scoped purging off', async () => {
		vi.mocked(scopedCachePurgeEnabled).mockReturnValue(false);

		await requestScopedCacheIndexReap();

		expect(indexKeysComplete).not.toHaveBeenCalled();
	});
});

describe('runScopedCacheIndexReap', () => {
	it('reaps nothing while another pass holds the lock', async () => {
		vi.mocked(holdCacheLock).mockResolvedValueOnce(false);

		expect(await runScopedCacheIndexReap()).toBe(false);
		expect(reapScopedCacheIndex).not.toHaveBeenCalled();
		expect(releaseCacheLock).not.toHaveBeenCalled();
	});

	it('renews the lock while the pass runs', async () => {
		vi.mocked(reapScopedCacheIndex).mockImplementationOnce(async () => {
			await vi.advanceTimersByTimeAsync(30_000);

			return 0;
		});

		expect(await runScopedCacheIndexReap()).toBe(true);

		expect(vi.mocked(holdCacheLock).mock.calls).toEqual([
			[{}, 'scoped-cache-index:reap', 'pass-1', 120_000],
			[{}, 'scoped-cache-index:reap', 'pass-1', 120_000],
		]);
	});

	it(oneLine`
		answers the pass ran when the release is refused — the lock stays until
		its TTL
	`, async () => {
		vi.mocked(releaseCacheLock)
			.mockRejectedValueOnce(new Error('Connection is closed.'));

		expect(await runScopedCacheIndexReap()).toBe(true);
		expect(reapScopedCacheIndex).toHaveBeenCalledOnce();
	});

	it(oneLine`
		reaps nothing with a lock cache outside Redis — no other node reads it, and
		the index lives in Redis only
	`, async () => {
		vi.mocked(cacheEntryRawKeyOf).mockReturnValueOnce(null);

		expect(await runScopedCacheIndexReap()).toBe(false);
		expect(reapScopedCacheIndex).not.toHaveBeenCalled();
		expect(holdCacheLock).not.toHaveBeenCalled();
	});
});
