import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBus } from './bus/index.js';
import {
	tellPeersPermissionsCleared,
	tellPeersResponseCacheCleared,
} from './cache-peer-notice.js';
import { useLogger } from './logger/index.js';
import { redisConfigAvailable } from './redis/index.js';
import { nodeId } from './utils/node-id.js';

const env = vi.hoisted(() => {
	return {} as Record<string, unknown>;
});

vi.mock('@directus/env', () => ({ useEnv: () => env }));

vi.mock('./bus/index.js', () => {
	const bus = { publish: vi.fn() };

	return { useBus: () => bus };
});

vi.mock('./redis/index.js', () => {
	return { redisConfigAvailable: vi.fn() };
});

vi.mock('./logger/index.js', () => {
	const logger = { warn: vi.fn() };

	return { useLogger: () => logger };
});

beforeEach(() => {
	vi.mocked(redisConfigAvailable).mockReturnValue(true);
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe('tellPeersResponseCacheCleared', () => {
	it('tells the peers of a memory store to drop their responses', async () => {
		env['CACHE_STORE'] = 'memory';

		await tellPeersResponseCacheCleared();

		expect(useBus().publish).toHaveBeenCalledExactlyOnceWith('cacheCleared', {
			targets: ['response'],
			origin: nodeId,
		});
	});

	// One message, so a peer drops the roles before the responses built with them.
	it('names the permissions in the same message when they changed', async () => {
		env['CACHE_STORE'] = 'memory';

		await tellPeersResponseCacheCleared({ permissionsCleared: true });

		expect(useBus().publish).toHaveBeenCalledExactlyOnceWith('cacheCleared', {
			targets: ['permissions', 'response'],
			origin: nodeId,
		});
	});

	it('tells no peer of a Redis store, which the flush cleared once', async () => {
		env['CACHE_STORE'] = 'redis';

		await tellPeersResponseCacheCleared();

		expect(useBus().publish).not.toHaveBeenCalled();
	});

	it('tells no peer without Redis, as no node shares the bus', async () => {
		env['CACHE_STORE'] = 'memory';
		vi.mocked(redisConfigAvailable).mockReturnValue(false);

		await tellPeersResponseCacheCleared();

		expect(useBus().publish).not.toHaveBeenCalled();
	});

	it('logs a publish the bus refused, and answers', async () => {
		env['CACHE_STORE'] = 'memory';
		const refusal = new Error('ECONNREFUSED');
		vi.mocked(useBus().publish).mockRejectedValueOnce(refusal);

		await expect(tellPeersResponseCacheCleared()).resolves.toBeUndefined();

		expect(useLogger().warn).toHaveBeenCalledExactlyOnceWith(
			refusal,
			'[cache] could not tell the other nodes to drop their responses:'
				+ ' Error: ECONNREFUSED',
		);
	});
});

describe('tellPeersPermissionsCleared', () => {
	// The writer clears the shared responses once: a peer still reading its own
	// copy of the old permissions would fill them again with the old roles.
	it('tells the peers of a Redis store to drop their own permissions', async () => {
		env['CACHE_STORE'] = 'redis';

		await tellPeersPermissionsCleared({ permissionsCleared: true });

		expect(useBus().publish).toHaveBeenCalledExactlyOnceWith('cacheCleared', {
			targets: ['permissions'],
			origin: nodeId,
		});
	});

	it('tells no peer of a Redis store when no permission changed', async () => {
		env['CACHE_STORE'] = 'redis';

		await tellPeersPermissionsCleared({ permissionsCleared: false });

		expect(useBus().publish).not.toHaveBeenCalled();
	});

	// Its peers hear the permissions in the message naming their responses.
	it('tells no peer of a memory store', async () => {
		env['CACHE_STORE'] = 'memory';

		await tellPeersPermissionsCleared({ permissionsCleared: true });

		expect(useBus().publish).not.toHaveBeenCalled();
	});

	it('tells no peer without Redis, as no node shares the bus', async () => {
		env['CACHE_STORE'] = 'redis';
		vi.mocked(redisConfigAvailable).mockReturnValue(false);

		await tellPeersPermissionsCleared({ permissionsCleared: true });

		expect(useBus().publish).not.toHaveBeenCalled();
	});

	// A failover's READONLY or a restart's LOADING passes within the second.
	it('tells the peers on a second try when the bus refused the first', async () => {
		env['CACHE_STORE'] = 'redis';
		vi.useFakeTimers();

		vi.mocked(useBus().publish)
			.mockRejectedValueOnce(new Error('ECONNREFUSED'));

		const told = tellPeersPermissionsCleared({ permissionsCleared: true });
		await vi.runAllTimersAsync();
		await told;

		expect(vi.mocked(useBus().publish).mock.calls).toEqual([
			['cacheCleared', { targets: ['permissions'], origin: nodeId }],
			['cacheCleared', { targets: ['permissions'], origin: nodeId }],
		]);

		expect(useLogger().warn).not.toHaveBeenCalled();
	});

	it('logs a notice the bus refused on every try, and answers', async () => {
		env['CACHE_STORE'] = 'redis';
		vi.useFakeTimers();
		const refusal = new Error('ECONNREFUSED');

		vi.mocked(useBus().publish)
			.mockRejectedValueOnce(refusal)
			.mockRejectedValueOnce(refusal)
			.mockRejectedValueOnce(refusal)
			.mockRejectedValueOnce(refusal);

		const told = tellPeersPermissionsCleared({ permissionsCleared: true });
		await vi.runAllTimersAsync();

		await expect(told).resolves.toBeUndefined();

		expect(useBus().publish).toHaveBeenCalledTimes(4);

		expect(useLogger().warn).toHaveBeenCalledExactlyOnceWith(
			refusal,
			'[cache] could not tell the other nodes to drop their permissions: the'
				+ ' bus refused the "cacheCleared" message naming ["permissions"]'
				+ ' 4 times, the last with: Error: ECONNREFUSED',
		);
	});
});
