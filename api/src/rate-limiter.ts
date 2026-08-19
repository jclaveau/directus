import { useEnv } from '@directus/env';
import { merge } from 'lodash-es';
import type { IRateLimiterOptions, IRateLimiterStoreOptions, RateLimiterAbstract } from 'rate-limiter-flexible';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import {
	warnOncePerConnectionOutage,
} from './redis/lib/warn-once-per-connection-outage.js';
import { getConfigFromEnv } from './utils/get-config-from-env.js';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

type IRateLimiterOptionsOverrides = Partial<IRateLimiterOptions> | Partial<IRateLimiterStoreOptions>;

export function createRateLimiter(
	configPrefix = 'RATE_LIMITER',
	configOverrides?: IRateLimiterOptionsOverrides,
): RateLimiterAbstract {
	const env = useEnv();

	switch (env['RATE_LIMITER_STORE']) {
		case 'redis':
			return new RateLimiterRedis(getConfig('redis', configPrefix, configOverrides));
		case 'memory':
		default:
			return new RateLimiterMemory(getConfig('memory', configPrefix, configOverrides));
	}
}

export { RateLimiterRes };

function getConfig(
	store: 'memory',
	configPrefix: string,
	overrides?: IRateLimiterOptionsOverrides,
): IRateLimiterOptions;
function getConfig(
	store: 'redis',
	configPrefix: string,
	overrides?: IRateLimiterOptionsOverrides,
): IRateLimiterStoreOptions;
function getConfig(
	store: 'memory' | 'redis' = 'memory',
	configPrefix = 'RATE_LIMITER',
	overrides?: IRateLimiterOptionsOverrides,
): IRateLimiterOptions | IRateLimiterStoreOptions {
	const config: any = getConfigFromEnv(`${configPrefix}_`, { omitPrefix: `${configPrefix}_${store}_` });

	if (store === 'redis') {
		const Redis = require('ioredis');

		const env = useEnv();

		config.storeClient = new Redis(env[`REDIS`] || getConfigFromEnv(`REDIS_`));

		// One client per configured limiter, none of them shared, so this is the only
		// place an `error` listener can be put on them — and without one an outage is
		// reported as a raw `console.error` stack per failed reconnect rather than
		// through the logger. `RATE_LIMITER_GLOBAL` reports as `[rate-limiter-global]`.
		// What the limiter does is unchanged: it still refuses what it cannot count.
		const limiterLabel = configPrefix.toLowerCase().replace(/_/g, '-');

		warnOncePerConnectionOutage(config.storeClient, limiterLabel);
	}

	delete config.enabled;
	delete config.store;

	merge(config, overrides || {});

	return config;
}
