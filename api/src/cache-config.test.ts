import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	initCacheConfig,
	publishCacheConfigChanged,
	refreshCacheTtlOverride,
	resolvedCacheTtl,
} from './cache-config.js';
import getDatabase from './database/index.js';

const env: Record<string, any> = {
	CACHE_TTL: '10m',
};

vi.mock('@directus/env', () => ({ useEnv: () => env }));
vi.mock('./database/index.js', () => ({ default: vi.fn() }));

const mockBus = { publish: vi.fn(), subscribe: vi.fn() };
vi.mock('./bus/index.js', () => ({ useBus: () => mockBus }));

// The last handler `subscribe` was registered with — invoked to simulate a peer's
// `cacheConfigChanged` delivery.
let busHandler: (payload: { ttl: string | null }) => void;

let settingsRow: { cache_ttl: string | null } | undefined;

function stubDatabase() {
	const builder: any = {
		select: vi.fn(() => builder),
		from: vi.fn(() => builder),
		first: vi.fn(() => Promise.resolve(settingsRow)),
	};

	vi.mocked(getDatabase).mockReturnValue(builder as any);
}

beforeEach(() => {
	env['CACHE_TTL'] = '10m';
	settingsRow = { cache_ttl: null };
	stubDatabase();

	mockBus.subscribe.mockImplementation((_channel: string, handler: any) => {
		busHandler = handler;
	});
});

afterEach(async () => {
	// Reset the module mirror to "no override" so a value set by one test can't leak
	// into the next (the override lives in module scope, not per-test).
	await refreshCacheTtlOverride();
	vi.clearAllMocks();
});

describe('resolvedCacheTtl', () => {
	it('falls back to env CACHE_TTL when no override is set', async () => {
		settingsRow = { cache_ttl: null };
		await refreshCacheTtlOverride();

		expect(resolvedCacheTtl()).toBe('10m');
	});

	it('returns the settings override in preference to env', async () => {
		settingsRow = { cache_ttl: '30s' };
		await refreshCacheTtlOverride();

		expect(resolvedCacheTtl()).toBe('30s');
	});

	it('preserves a "0" override rather than treating it as unset', async () => {
		settingsRow = { cache_ttl: '0' };
		await refreshCacheTtlOverride();

		expect(resolvedCacheTtl()).toBe('0');
	});

	it('treats an empty/whitespace override as unset and inherits env', async () => {
		settingsRow = { cache_ttl: '   ' };
		await refreshCacheTtlOverride();

		expect(resolvedCacheTtl()).toBe('10m');
	});
});

describe('publishCacheConfigChanged', () => {
	it('applies the value locally and broadcasts the normalised ttl', () => {
		publishCacheConfigChanged('45s');

		expect(resolvedCacheTtl()).toBe('45s');

		expect(mockBus.publish).toHaveBeenCalledWith('cacheConfigChanged', {
			ttl: '45s',
		});
	});

	it('normalises an empty value to null so peers inherit env', () => {
		publishCacheConfigChanged('');

		expect(resolvedCacheTtl()).toBe('10m');

		expect(mockBus.publish).toHaveBeenCalledWith('cacheConfigChanged', {
			ttl: null,
		});
	});
});

describe('initCacheConfig', () => {
	it('seeds from settings and applies a later bus message', async () => {
		settingsRow = { cache_ttl: '5m' };
		await initCacheConfig();

		expect(resolvedCacheTtl()).toBe('5m');

		expect(mockBus.subscribe).toHaveBeenCalledWith(
			'cacheConfigChanged',
			expect.any(Function),
		);

		// A peer publishes a change; the handler flips the mirror with no DB read.
		busHandler({ ttl: '90s' });
		expect(resolvedCacheTtl()).toBe('90s');

		// A cleared override on the bus falls back to env.
		busHandler({ ttl: null });
		expect(resolvedCacheTtl()).toBe('10m');
	});
});
