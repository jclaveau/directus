import { useEnv } from '@directus/env';
import type { IRateLimiterOptions, IRateLimiterStoreOptions, RateLimiterAbstract } from 'rate-limiter-flexible';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import {
	warnOncePerConnectionOutage,
} from './redis/lib/warn-once-per-connection-outage.js';
import { getConfigFromEnv } from './utils/get-config-from-env.js';
import { merge } from './utils/lodash-es-used.js';

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
		// one we make: stop limiting. Without a fallback `consume()` rejects with the
		// connection error, `rate-limiter-ip` rethrows anything that is an Error, and
		// every charged request answers 500 for as long as Redis is away — an outage in
		// a dependency taking the API down, which is the failure this whole branch
		// exists to remove.
		//
		// Counting per process instead was the other option and is worse than it looks:
		// N instances would each grant the whole budget, which is not the configured
		// limit and not a knowable one either. An unreachable Redis is rare and brief,
		// so the honest answer is to admit there is no limit for that moment rather
		// than to enforce a number nobody chose. Redis keeps its counters and their
		// TTLs throughout, so the limit resumes from where it was rather than from
		// zero the moment the store answers again.
		const noLimitWhileRedisIsAway = new RateLimiterMemory({
			points: Number.MAX_SAFE_INTEGER,
			duration: 1,
		});

		config.insuranceLimiter = noLimitWhileRedisIsAway;

		// And reach it without waiting. Left to itself the limiter sends the command
		// anyway and falls back only once ioredis gives up on it, which at ioredis's own
		// defaults is around ten seconds — its client is built here rather than by
		// `createRedis`, so `REDIS_RETRY_*` never reaches it. Every charged request
		// would stall for that before being served, which is failing open slowly enough
		// to be indistinguishable from failing closed. Asking first costs a status read.
		config.rejectIfRedisNotReady = true;
	}

	return config;
}
