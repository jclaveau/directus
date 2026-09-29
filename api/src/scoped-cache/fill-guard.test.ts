import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bumpScopedCacheEpochs } from './fill-guard.js';
import { useScopedCacheStore } from './store.js';

// Hoisted: the module under test reads `useEnv()` once, at import.
const env = vi.hoisted(() => {
	return { CACHE_NAMESPACE: 'ns' } as Record<string, any>;
});

vi.mock('@directus/env', () => ({ useEnv: () => env }));
vi.mock('../logger/index.js', () => ({ useLogger: vi.fn() }));
vi.mock('./config.js', () => ({ scopedCachePurgeEnabled: () => true }));
vi.mock('./store.js', () => ({ useScopedCacheStore: vi.fn() }));

describe('bumpScopedCacheEpochs', () => {
	const bumpPurgeEpochs = vi.fn();

	beforeEach(() => {
		vi.mocked(useScopedCacheStore)
			.mockReturnValue({ bumpPurgeEpochs } as any);
	});

	afterEach(() => {
		delete env['CACHE_SCOPED_EPOCH_TTL'];
		vi.restoreAllMocks();
		bumpPurgeEpochs.mockReset();
	});

	// `EXPIRE … 0` deletes the counter it was meant to hold, so every fill racing
	// the purge would read no counter on both sides and be kept.
	it('holds the counter a day when the duration is zero', async () => {
		env['CACHE_SCOPED_EPOCH_TTL'] = '0';

		await bumpScopedCacheEpochs(['articles']);

		expect(bumpPurgeEpochs).toHaveBeenCalledWith(
			['ns:scoped-cache-epoch:articles'],
			24 * 60 * 60,
		);
	});

	it('holds the counter a day when the duration is negative', async () => {
		env['CACHE_SCOPED_EPOCH_TTL'] = '-5m';

		await bumpScopedCacheEpochs(['articles']);

		expect(bumpPurgeEpochs).toHaveBeenCalledWith(
			['ns:scoped-cache-epoch:articles'],
			24 * 60 * 60,
		);
	});

	it('holds the counter a day when the duration is the number zero', async () => {
		env['CACHE_SCOPED_EPOCH_TTL'] = 0;

		await bumpScopedCacheEpochs(['articles']);

		expect(bumpPurgeEpochs).toHaveBeenCalledWith(
			['ns:scoped-cache-epoch:articles'],
			24 * 60 * 60,
		);
	});

	it('raises a sub-second duration to five minutes', async () => {
		env['CACHE_SCOPED_EPOCH_TTL'] = '10ms';

		await bumpScopedCacheEpochs(['articles']);

		expect(bumpPurgeEpochs).toHaveBeenCalledWith(
			['ns:scoped-cache-epoch:articles'],
			300,
		);
	});

	it('raises a one-minute duration to five minutes', async () => {
		env['CACHE_SCOPED_EPOCH_TTL'] = '1m';

		await bumpScopedCacheEpochs(['articles']);

		expect(bumpPurgeEpochs).toHaveBeenCalledWith(
			['ns:scoped-cache-epoch:articles'],
			300,
		);
	});

	it('keeps a duration above five minutes as given', async () => {
		env['CACHE_SCOPED_EPOCH_TTL'] = '6m';

		await bumpScopedCacheEpochs(['articles']);

		expect(bumpPurgeEpochs).toHaveBeenCalledWith(
			['ns:scoped-cache-epoch:articles'],
			360,
		);
	});
});
