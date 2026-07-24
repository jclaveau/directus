import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCacheTargets, getCache } from './cache.js';
import { dropScopedCacheTagIndex } from './scoped-cache.js';

// hoisted: cache.ts reads `const env = useEnv()` at module load, before a plain
// `const env` below would be initialised (temporal dead zone).
const env = vi.hoisted(() => {
	return {
		CACHE_ENABLED: true,
		CACHE_STORE: 'memory',
		CACHE_NAMESPACE: 'ns',
		CACHE_TTL: '10m',
		CACHE_SYSTEM_TTL: '10m',
	} as Record<string, any>;
});

vi.mock('@directus/env', () => ({ useEnv: () => env }));
vi.mock('./redis/index.js', () => ({ redisConfigAvailable: () => false }));
vi.mock('./scoped-cache.js', () => ({ dropScopedCacheTagIndex: vi.fn() }));
vi.mock('./permissions/cache.js', () => ({ clearCache: vi.fn() }));
vi.mock('./logger/index.js', () => ({ useLogger: () => ({ warn: vi.fn() }) }));
vi.mock('./utils/validate-env.js', () => ({ validateEnv: vi.fn() }));

// hoisted for the same reason as `env`: cache.ts binds `const messenger = useBus()`
// at module load.
const mockBus = vi.hoisted(() => {
	return { publish: vi.fn(), subscribe: vi.fn() };
});

vi.mock('./bus/index.js', () => ({ useBus: () => mockBus }));

async function seedAllTiers() {
	const { cache, systemCache, lockCache } = getCache();

	await Promise.all([
		cache!.set('response-key', 'r'),
		systemCache.set('system-key', 's'),
		lockCache.set('lock-key', 'l'),
	]);

	return { cache: cache!, systemCache, lockCache };
}

afterEach(() => {
	vi.clearAllMocks();
});

describe('clearCacheTargets', () => {
	it('response: drops response cache + tag index, spares the rest', async () => {
		const { cache, systemCache, lockCache } = await seedAllTiers();

		await clearCacheTargets(['response']);

		expect(await cache.get('response-key')).toBeUndefined();
		expect(await systemCache.get('system-key')).toBe('s');
		expect(await lockCache.get('lock-key')).toBe('l');
		expect(dropScopedCacheTagIndex).toHaveBeenCalledOnce();
	});

	it('system: clears the system cache and fans out via schemaChanged', async () => {
		const { cache, systemCache } = await seedAllTiers();

		await clearCacheTargets(['system']);

		expect(await systemCache.get('system-key')).toBeUndefined();
		expect(await cache.get('response-key')).toBe('r');
		expect(dropScopedCacheTagIndex).not.toHaveBeenCalled();

		expect(mockBus.publish).toHaveBeenCalledWith(
			'schemaChanged',
			expect.anything(),
		);
	});

	it('locks: clears only the lock cache', async () => {
		const { cache, systemCache, lockCache } = await seedAllTiers();

		await clearCacheTargets(['locks']);

		expect(await lockCache.get('lock-key')).toBeUndefined();
		expect(await cache.get('response-key')).toBe('r');
		expect(await systemCache.get('system-key')).toBe('s');
	});

	it('broadcasts the exact targets for peers to drop the same subset', async () => {
		await seedAllTiers();

		await clearCacheTargets(['response', 'locks']);

		expect(mockBus.publish).toHaveBeenCalledWith('cacheCleared', {
			targets: ['response', 'locks'],
		});
	});
});
