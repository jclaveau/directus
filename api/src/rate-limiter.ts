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

	delete config.enabled;
	delete config.store;

	merge(config, overrides || {});

	if (store === 'redis') {
		const Redis = require('ioredis');

		const env = useEnv();

		config.storeClient = new Redis(env[`REDIS`] || getConfigFromEnv(`REDIS_`));

		// One client per configured limiter, none of them shared, so this is the only
		// place an `error` listener can be put on them — and without one an outage is
		// reported as a raw `console.error` stack per failed reconnect rather than
		// through the logger. `RATE_LIMITER_GLOBAL` reports as `[rate-limiter-global]`.
		const limiterLabel = configPrefix.toLowerCase().replace(/_/g, '-');

		warnOncePerConnectionOutage(config.storeClient, limiterLabel);

		// What the limiter does when it cannot reach Redis is a choice, and this is the
		// one we make: keep serving. Without a fallback `consume()` rejects with the
		// connection error, `rate-limiter-ip` rethrows anything that is an Error, and
		// every charged request answers 500 for as long as Redis is away — an outage in
		// a dependency taking the API down, which is the failure this whole branch
		// exists to remove.
		//
		// The cost is real and worth stating: the fallback counts in this process only,
		// so while Redis is away N instances each grant the full budget and the
		// effective limit is N times what it says. Under-enforcing a limit for the
		// length of an outage beats refusing everyone for it.
		//
		// Built after the overrides are merged, so it mirrors the limits actually in
		// force rather than the ones the env asked for — `authentication.ts` passes
		// `duration: 0` and would otherwise fall back to a different limiter than the
		// one it configured. `blockDuration` and `execEvenly` the library copies over
		// itself.
		config.insuranceLimiter = new RateLimiterMemory({
			points: config.points,
			duration: config.duration,
		});
	}

	return config;
}
