import { useEnv } from '@directus/env';
import { CacheMulti, defineCache, type CacheConfig } from '@directus/memory';
import { redisConfigAvailable, useRedis } from '../redis/index.js';
import { runningReads } from './running-reads.js';

const localOnly = redisConfigAvailable() === false;

// Named after the deployment, like the bus and the lock: a peer deployment on
// the same Redis clearing its permissions would otherwise empty these too.
const config: CacheConfig = localOnly
	? {
			type: 'local',
			maxKeys: 500,
		}
	: {
			type: 'multi',
			redis: {
				namespace: `${useEnv()['CACHE_NAMESPACE']}:permissions`,
				redis: useRedis(),
			},
			local: {
				maxKeys: 100,
			},
		};

export const useCache = defineCache(config);

export function clearCache() {
	const cache = useCache();
	runningReads.clear();

	return cache.clear();
}

/**
 * Drop the permissions this process holds, telling no other process: the node
 * that sent the clear dropped the shared tier and told every node already.
 */
export async function clearLocalCache() {
	const cache = useCache();
	runningReads.clear();

	if (cache instanceof CacheMulti) {
		await cache.clearLocalTier();

		return;
	}

	await cache.clear();
}
