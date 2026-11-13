import { useEnv } from '@directus/env';
import { defineCache } from '@directus/memory';
import type { Redis } from 'ioredis';
import { afterEach, expect, test, vi } from 'vitest';
import { redisConfigAvailable, useRedis } from '../redis/index.js';

vi.mock('../redis/index.js');
vi.mock('@directus/memory');
vi.mock('@directus/env');

afterEach(() => {
	vi.clearAllMocks();
	vi.resetModules();
});

test('Names the Redis permission cache after the deployment', async () => {
	const mockRedis = {} as unknown as Redis;
	vi.mocked(redisConfigAvailable).mockReturnValue(true);
	vi.mocked(useRedis).mockReturnValue(mockRedis);
	vi.mocked(useEnv).mockReturnValue({ CACHE_NAMESPACE: 'planner-api' });

	await import('./cache.js');

	expect(defineCache).toHaveBeenCalledWith({
		type: 'multi',
		redis: { namespace: 'planner-api:permissions', redis: mockRedis },
		local: { maxKeys: 100 },
	});
});

test('Keeps the permission cache local without Redis', async () => {
	vi.mocked(redisConfigAvailable).mockReturnValue(false);
	vi.mocked(useEnv).mockReturnValue({ CACHE_NAMESPACE: 'planner-api' });

	await import('./cache.js');

	expect(defineCache).toHaveBeenCalledWith({ type: 'local', maxKeys: 500 });
});
