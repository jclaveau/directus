import { useEnv } from '@directus/env';
import type { CacheFlushTarget, SchemaOverview } from '@directus/types';
import Keyv, { type KeyvOptions } from 'keyv';
import { useBus } from './bus/index.js';
import { useLogger } from './logger/index.js';
import { clearCache as clearPermissionCache } from './permissions/cache.js';
import { redisConfigAvailable } from './redis/index.js';
import {
	type ConnectionEvents,
	warnOncePerConnectionOutage,
} from './redis/lib/warn-once-per-connection-outage.js';
import { dropScopedCacheTagIndex } from './scoped-cache.js';
import { compress, decompress } from './utils/compress.js';
import { getConfigFromEnv } from './utils/get-config-from-env.js';
import { getMilliseconds } from './utils/get-milliseconds.js';
import { validateEnv } from './utils/validate-env.js';

import { createRequire } from 'node:module';
import { freezeSchema, unfreezeSchema } from './utils/freeze-schema.js';

const logger = useLogger();
const env = useEnv();

const require = createRequire(import.meta.url);

let cache: Keyv | null = null;
let systemCache: Keyv | null = null;
let lockCache: Keyv | null = null;
let messengerSubscribed = false;

let localSchemaCache: Keyv | null = null;
let memorySchemaCache: Readonly<SchemaOverview> | null = null;

type Store = 'memory' | 'redis';

const messenger = useBus();

interface CacheMessage {
	autoPurgeCache: boolean | undefined;
}

interface CacheMessage {
	autoPurgeCache: boolean | undefined;
}

// The subset a flush drops, chosen per-target on the cache page. `system` rides the
// existing `schemaChanged` broadcast; `response`/`locks` are per-node memory tiers a
// dedicated channel has to reach (see `clearCacheTargets`).
interface CacheClearMessage {
	targets: CacheFlushTarget[];
}

if (redisConfigAvailable() && !messengerSubscribed) {
	messengerSubscribed = true;

	messenger.subscribe<CacheMessage>('schemaChanged', async (opts) => {
		if (env['CACHE_STORE'] === 'memory' && env['CACHE_AUTO_PURGE'] && cache && opts?.['autoPurgeCache'] !== false) {
			await cache.clear();
		}

		await localSchemaCache?.clear();
		memorySchemaCache = null;
	});

	messenger.subscribe<CacheClearMessage>('cacheCleared', async ({ targets }) => {
		// Redis-backed tiers are shared, so the initiator already cleared them globally;
		// only a per-node memory store leaves each node its own copy to drop here.
		if (env['CACHE_STORE'] !== 'memory') {
			return;
		}

		const { cache, systemCache, lockCache } = getCache();

		if (targets.includes('response')) {
			await cache?.clear();
		}

		// `schemaChanged` (from the initiator's clearSystemCache) drops each peer's
		// localSchemaCache but NOT its `_system` Keyv — so carry that clear here, else a
		// memory-store peer keeps a stale system cache after a "System cache" flush.
		if (targets.includes('system')) {
			await systemCache.clear();
		}

		if (targets.includes('locks')) {
			await lockCache.clear();
		}
	});
}

/**
 * Report what goes wrong with one cache, under that cache's own name.
 *
 * Two things have to be heard from. `@keyv/redis` v5 wraps a node-redis client
 * of its own and Keyv does not re-emit its `error` events, so without a listener
 * there an unreachable Redis took the process down through it even once the
 * ioredis clients were handled. And the store reports what its own commands hit,
 * which since `disableOfflineQueue` is one error per refused command — a log that
 * grows with traffic rather than with the outage.
 *
 * Both are the same failure, so both go under one label and share one throttle.
 * Attached here rather than where the client is built, because a shared label
 * across the four caches names none of them, and this is where the names live.
 * Nothing has connected yet at this point: node-redis dials on its first command.
 */
function warnOnCacheFailure(keyv: Keyv, cacheLabel: string): void {
	const { client } = keyv.store as { client?: ConnectionEvents };

	// A memory store has no client, and fails for reasons that are not outages —
	// serialization, not connectivity — so there is nothing to collapse and nothing to
	// wait for. Every one of those is worth a line.
	if (client === undefined) {
		keyv.on('error', (error) => logger.warn(error, `[${cacheLabel}] ${error}`));
		return;
	}

	warnOncePerConnectionOutage(client, cacheLabel, keyv);
}

export function getCache(): {
	cache: Keyv | null;
	systemCache: Keyv;
	localSchemaCache: Keyv;
	lockCache: Keyv;
} {
	const store: Store = env['CACHE_STORE'] === 'redis'
		? 'redis'
		: 'memory';

	if (env['CACHE_ENABLED'] === true && cache === null) {
		validateEnv(['CACHE_NAMESPACE', 'CACHE_TTL', 'CACHE_STORE']);

		cache = getKeyvInstance(
			store,
			getMilliseconds(env['CACHE_TTL']),
			'_response',
		);

		warnOnCacheFailure(cache, 'response-cache');
	}

	if (systemCache === null) {
		systemCache = getKeyvInstance(
			store,
			getMilliseconds(env['CACHE_SYSTEM_TTL']),
			'_system',
		);

		warnOnCacheFailure(systemCache, 'system-cache');
	}

	if (localSchemaCache === null) {
		localSchemaCache = getKeyvInstance('memory', getMilliseconds(env['CACHE_SYSTEM_TTL']), '_schema');
		warnOnCacheFailure(localSchemaCache, 'schema-cache');
	}

	if (lockCache === null) {
		lockCache = getKeyvInstance(store, undefined, '_lock');
		warnOnCacheFailure(lockCache, 'lock-cache');
	}

	return { cache, systemCache, localSchemaCache, lockCache };
}

export async function flushCaches(forced?: boolean): Promise<void> {
	const { cache } = getCache();
	await clearSystemCache({ forced });
	await cache?.clear();
}

export async function clearSystemCache(opts?: {
	forced?: boolean | undefined;
	autoPurgeCache?: false | undefined;
}): Promise<void> {
	const { systemCache, localSchemaCache, lockCache } = getCache();

	// Flush system cache when forced or when system cache lock not set
	if (opts?.forced || !(await lockCache.get('system-cache-lock'))) {
		await lockCache.set('system-cache-lock', true, 10000);
		await systemCache.clear();
		await lockCache.delete('system-cache-lock');
	}

	await localSchemaCache.clear();
	memorySchemaCache = null;

	// Since a lot of cached permission function rely on the schema it needs to be cleared as well
	await clearPermissionCache();

	messenger.publish<CacheMessage>('schemaChanged', { autoPurgeCache: opts?.autoPurgeCache });
}

/**
 * Flush a chosen subset of the cache and tell every node to drop the same subset of
 * its per-node memory tiers. A blanket flush is deliberately not the default:
 * `system` is auto-invalidated on schema change and costly to rebuild, and `locks`
 * holds the build-identity fingerprint whose loss forces a full re-flush next boot.
 */
export async function clearCacheTargets(targets: CacheFlushTarget[]): Promise<void> {
	const { cache, lockCache } = getCache();

	if (targets.includes('system')) {
		// forced so it runs even while a lock is held; its `schemaChanged` publish
		// fans the system + schema + permissions clear out to every node.
		await clearSystemCache({ forced: true });
	}

	if (targets.includes('response')) {
		await cache?.clear();
		// The scoped-tag index lives in raw Redis outside the Keyv namespace, so the
		// clear above misses it — drop it too so no orphan tag pointers linger.
		await dropScopedCacheTagIndex();
	}

	if (targets.includes('locks')) {
		await lockCache.clear();
	}

	messenger.publish<CacheClearMessage>('cacheCleared', { targets });
}

export async function setSystemCache(key: string, value: any, ttl?: number): Promise<void> {
	const { systemCache, lockCache } = getCache();

	if (!(await lockCache.get('system-cache-lock'))) {
		await setCacheValue(systemCache, key, value, ttl);
	}
}

export async function getSystemCache(key: string): Promise<Record<string, any>> {
	const { systemCache } = getCache();

	return await getCacheValue(systemCache, key);
}

export function setMemorySchemaCache(schema: SchemaOverview) {
	if (Object.isFrozen(schema)) {
		memorySchemaCache = schema;
	}
	else {
		memorySchemaCache = freezeSchema(schema);
	}
}

export function getMemorySchemaCache(): Readonly<SchemaOverview> | undefined {
	if (env['CACHE_SCHEMA_FREEZE_ENABLED']) {
		return memorySchemaCache ?? undefined;
	}
	else if (memorySchemaCache) {
		return unfreezeSchema(memorySchemaCache);
	}

	return undefined;
}

export async function setCacheValue(
	cache: Keyv,
	key: string,
	value: Record<string, any> | Record<string, any>[],
	ttl?: number,
) {
	const compressed = await compress(value);
	await cache.set(key, compressed, ttl);
}

export async function getCacheValue(cache: Keyv, key: string): Promise<any> {
	const value = await cache.get(key);

	if (!value) {
		return undefined;
	}

	const decompressed = await decompress(value);
	return decompressed;
}

function getKeyvInstance(
	store: Store,
	ttl: number | undefined,
	namespaceSuffix?: string,
): Keyv {
	switch (store) {
		case 'redis':
			return new Keyv(getConfig('redis', ttl, namespaceSuffix));
		case 'memory':
		default:
			return new Keyv(getConfig('memory', ttl, namespaceSuffix));
	}
}

function getConfig(store: Store = 'memory', ttl: number | undefined, namespaceSuffix = ''): KeyvOptions {
	const config: KeyvOptions = {
		namespace: `${env['CACHE_NAMESPACE']}${namespaceSuffix}`,
		...(ttl && { ttl }),
	};

	if (store === 'redis') {
		const { default: KeyvRedis } = require('@keyv/redis');
		const connection = getRedisConnection();

		// node-redis gives a command issued while it is reconnecting no deadline at all:
		// `sendCommand` rejects only when the client is closed or when this flag is set,
		// and its default reconnect strategy retries forever. `KeyvRedis.getClient()`
		// does not help either — it returns early while `isOpen` is true, so its
		// `connectionTimeout` guards the first connect and nothing after it. A cached
		// read during an outage therefore never settled, and the request that made it
		// blocked for as long as Redis was away instead of missing.
		//
		// Rejecting instead is the behaviour the rest of the stack already expects:
		// `@keyv/redis` swallows the rejection into `undefined`, which is exactly the
		// MISS the response cache serves when it has nothing. Losing Redis costs hit
		// ratio again, rather than availability.
		//
		// Passing options rather than the URL string also settles which reconnect
		// strategy applies. `KeyvRedis` installs its own only on the string form, so a
		// `REDIS` url and a `REDIS_HOST`/`REDIS_PORT` pair used to back off differently
		// (2^n*100ms vs 2^n*50ms, both capped at 2s). Both now use node-redis's.
		const clientOptions = typeof connection === 'string'
			? { url: connection }
			: connection;

		const keyvRedis = new KeyvRedis({
			...clientOptions,
			disableOfflineQueue: true,
		});

		config.store = keyvRedis;
	}

	return config;
}

// @keyv/redis v5 is node-redis based: it accepts a URL string or node-redis RedisClientOptions
// ({ socket: { host, port }, … }), not ioredis's flat { host, port }. env['REDIS'] is already a URL;
// otherwise translate the REDIS_* (ioredis-shaped) config into node-redis options so a host/port
// setup actually connects (a flat { host, port } silently falls back to localhost:6379 under v5).
// Advanced setups (sentinel/cluster, cert-based TLS) should use the REDIS connection URL.
export function getRedisConnection(): string | Record<string, unknown> {
	const url = env['REDIS'];

	// node-redis defaults its socket `keepAlive` to 5000ms → a TCP keepalive probe every 5s on the
	// persistent cache connection. That outbound traffic blocks Railway App-Sleeping on an otherwise-idle
	// preview. `REDIS_KEEP_ALIVE=false` disables the probe; a large ms value spaces it past the sleep
	// window. Unset → node-redis's 5000ms default is preserved untouched (prod is unaffected).
	const keepAlive = env['REDIS_KEEP_ALIVE'] as number | boolean | undefined;

	if (url) {
		if (keepAlive === undefined) {
			return url as string;
		}

		return { url, socket: { keepAlive } };
	}

	const { host, port, username, password, db, tls } = getConfigFromEnv('REDIS') as Record<string, any>;

	return {
		socket: {
			host,
			...(port !== undefined && { port: Number(port) }),
			...(tls && { tls: true }),
			...(keepAlive !== undefined && { keepAlive }),
		},
		...(username !== undefined && { username }),
		...(password !== undefined && { password }),
		...(db !== undefined && { database: Number(db) }),
	};
}
