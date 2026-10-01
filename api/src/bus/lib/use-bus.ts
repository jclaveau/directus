import { useEnv } from '@directus/env';
import { createBus, type Bus } from '@directus/memory';
import { redisConfigAvailable, useRedis } from '../../redis/index.js';

export const _cache: { bus: Bus | undefined } = {
	bus: undefined,
};

/**
 * Returns globally shared message bus. If Redis is available, will use a redis-driven pub/sub bus.
 * Otherwise will default to a local-only bus.
 *
 * Redis pub/sub is global to the server, so every deployment sharing a Redis
 * hears every other's bus unless its channel prefix tells them apart. The
 * cache namespace already names the deployment, so the bus follows it; a
 * deployment whose nodes keep separate caches over one bus names that bus
 * itself.
 */
export const useBus = () => {
	if (_cache.bus) {
		return _cache.bus;
	}

	if (redisConfigAvailable()) {
		const env = useEnv();

		_cache.bus = createBus({
			type: 'redis',
			redis: useRedis(),
			namespace: String(env['BUS_NAMESPACE'] ?? `${env['CACHE_NAMESPACE']}:bus`),
		});
	} else {
		_cache.bus = createBus({ type: 'local' });
	}

	return _cache.bus;
};
