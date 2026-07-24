import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// hoisted: cache.ts reads env + registers its bus subscribers at module load.
const env = vi.hoisted(() => {
	return {
		CACHE_ENABLED: true,
		CACHE_STORE: 'memory',
		CACHE_AUTO_PURGE: true,
		CACHE_NAMESPACE: 'ns',
		CACHE_TTL: '10m',
		CACHE_SYSTEM_TTL: '10m',
	} as Record<string, any>;
});

vi.mock('@directus/env', () => ({ useEnv: () => env }));

// Capture the handlers cache.ts registers at load, so the tests can drive the
// peer side of each bus channel (the initiator side lives in cache-clear-targets).
const handlers = vi.hoisted(() => {
	return {} as Record<string, (payload: any) => unknown>;
});

function busMock() {
	return {
		subscribe: (channel: string, handler: any) => {
			handlers[channel] = handler;
		},
		publish: vi.fn(),
	};
}

vi.mock('./bus/index.js', () => ({ useBus: busMock }));

// Redis "available" so the subscribe block registers; the tiers are still memory
// Keyv (store follows CACHE_STORE), so .set/.clear run in-process.
vi.mock('./redis/index.js', () => ({ redisConfigAvailable: () => true }));
vi.mock('./scoped-cache.js', () => ({ dropScopedCacheTagIndex: vi.fn() }));
vi.mock('./permissions/cache.js', () => ({ clearCache: vi.fn() }));
vi.mock('./logger/index.js', () => ({ useLogger: () => ({ warn: vi.fn() }) }));
vi.mock('./utils/validate-env.js', () => ({ validateEnv: vi.fn() }));

import { getCache } from './cache.js';

async function seedTiers() {
	const { cache, systemCache, lockCache } = getCache();

	await Promise.all([
		cache!.set('r', 'r'),
		systemCache.set('s', 's'),
		lockCache.set('l', 'l'),
	]);

	return { cache: cache!, systemCache, lockCache };
}

beforeEach(() => {
	env['CACHE_STORE'] = 'memory';
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('cacheCleared subscriber (peer-side flush)', () => {
	it('memory peer drops the response, system, and lock tiers it names', async () => {
		const { cache, systemCache, lockCache } = await seedTiers();

		await handlers['cacheCleared']!({ targets: ['response', 'system', 'locks'] });

		expect(await cache.get('r')).toBeUndefined();
		expect(await systemCache.get('s')).toBeUndefined();
		expect(await lockCache.get('l')).toBeUndefined();
	});

	it('memory peer clears only the named subset', async () => {
		const { cache, systemCache, lockCache } = await seedTiers();

		await handlers['cacheCleared']!({ targets: ['response'] });

		expect(await cache.get('r')).toBeUndefined();
		expect(await systemCache.get('s')).toBe('s');
		expect(await lockCache.get('l')).toBe('l');
	});

	it('redis peer is a no-op on the shared tiers', async () => {
		const tiers = await seedTiers();
		env['CACHE_STORE'] = 'redis';

		await handlers['cacheCleared']!({ targets: ['response', 'system', 'locks'] });

		expect(await tiers.cache.get('r')).toBe('r');
		expect(await tiers.systemCache.get('s')).toBe('s');
		expect(await tiers.lockCache.get('l')).toBe('l');
	});
});

describe('schemaChanged subscriber (peer-side)', () => {
	it('memory peer drops the response cache when auto-purge is on', async () => {
		const { cache } = await seedTiers();

		await handlers['schemaChanged']!({ autoPurgeCache: undefined });

		expect(await cache.get('r')).toBeUndefined();
	});

	it('memory peer keeps response cache on autoPurgeCache:false', async () => {
		const { cache } = await seedTiers();

		await handlers['schemaChanged']!({ autoPurgeCache: false });

		expect(await cache.get('r')).toBe('r');
	});
});
