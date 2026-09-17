import { useEnv } from '@directus/env';
import { createKv, type Kv } from '@directus/memory';
import { redisConfigAvailable, useRedis } from '../../redis/index.js';

export const _cache: { lock: Kv | undefined } = {
	lock: undefined,
};

/**
 * Returns globally shared lock kv instance.
 *
 * Named after the deployment, like the bus: a node that finds the schema
 * build lock taken waits on the bus for the holder's build, so a lock shared
 * wider than the bus would have it listening for a message another
 * deployment publishes out of its hearing.
 */
export const useLock = () => {
	if (_cache.lock) {
		return _cache.lock;
	}

	if (redisConfigAvailable()) {
		_cache.lock = createKv({
			type: 'redis',
			redis: useRedis(),
			namespace: `${useEnv()['CACHE_NAMESPACE']}:lock`,
		});
	} else {
		_cache.lock = createKv({ type: 'local' });
	}

	return _cache.lock;
};
