import { useEnv } from '@directus/env';
import type { CacheTag, EventContext, SchemaOverview } from '@directus/types';
import Keyv, { type KeyvOptions } from 'keyv';
import { useBus } from './bus/index.js';
import emitter from './emitter.js';
import { useLogger } from './logger/index.js';
import { clearCache as clearPermissionCache } from './permissions/cache.js';
import { redisConfigAvailable, useRedis } from './redis/index.js';
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

if (redisConfigAvailable() && !messengerSubscribed) {
	messengerSubscribed = true;

	messenger.subscribe<CacheMessage>('schemaChanged', async (opts) => {
		if (env['CACHE_STORE'] === 'memory' && env['CACHE_AUTO_PURGE'] && cache && opts?.['autoPurgeCache'] !== false) {
			await cache.clear();
		}

		await localSchemaCache?.clear();
		memorySchemaCache = null;
	});
}

export function getCache(): {
	cache: Keyv | null;
	systemCache: Keyv;
	localSchemaCache: Keyv;
	lockCache: Keyv;
} {
	if (env['CACHE_ENABLED'] === true && cache === null) {
		validateEnv(['CACHE_NAMESPACE', 'CACHE_TTL', 'CACHE_STORE']);
		cache = getKeyvInstance(env['CACHE_STORE'] as Store, getMilliseconds(env['CACHE_TTL']));
		cache.on('error', (err) => logger.warn(err, `[cache] ${err}`));
	}

	if (systemCache === null) {
		systemCache = getKeyvInstance(env['CACHE_STORE'] as Store, getMilliseconds(env['CACHE_SYSTEM_TTL']), '_system');
		systemCache.on('error', (err) => logger.warn(err, `[system-cache] ${err}`));
	}

	if (localSchemaCache === null) {
		localSchemaCache = getKeyvInstance('memory', getMilliseconds(env['CACHE_SYSTEM_TTL']), '_schema');
		localSchemaCache.on('error', (err) => logger.warn(err, `[schema-cache] ${err}`));
	}

	if (lockCache === null) {
		lockCache = getKeyvInstance(env['CACHE_STORE'] as Store, undefined, '_lock');
		lockCache.on('error', (err) => logger.warn(err, `[lock-cache] ${err}`));
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
	} else {
		memorySchemaCache = freezeSchema(schema);
	}
}

export function getMemorySchemaCache(): Readonly<SchemaOverview> | undefined {
	if (env['CACHE_SCHEMA_FREEZE_ENABLED']) {
		return memorySchemaCache ?? undefined;
	} else if (memorySchemaCache) {
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
	if (!value) return undefined;
	const decompressed = await decompress(value);
	return decompressed;
}

/**
 * Whether scoped (tag-based) cache purging is active. Requires the opt-in mode AND a Redis cache
 * store, since the tag→keys index lives in Redis sets. Any other config falls back to full flush.
 */
export function scopedCachePurgeEnabled(): boolean {
	return env['CACHE_AUTO_PURGE_MODE'] === 'scoped' && env['CACHE_STORE'] === 'redis' && redisConfigAvailable();
}

function serializeTagValue(value: unknown): string {
	return value === null || value === undefined ? 'null' : String(value);
}

function cacheTagKey(tag: CacheTag): string {
	const base = `${env['CACHE_NAMESPACE']}:tag:${tag.collection}`;
	return tag.field === undefined ? base : `${base}:${tag.field}=${serializeTagValue(tag.value)}`;
}

/**
 * Index a freshly-cached response key under every tag its data came from, so a later mutation can
 * drop just the matching entries instead of the whole namespace. Both the payload key and its
 * `__expires_at` sibling are tagged. Each tag set self-expires at twice the cache TTL as a safety net
 * against members orphaned by a crash between write and purge.
 */
export async function tagCacheKeys(key: string, tags: Iterable<CacheTag>): Promise<void> {
	if (!scopedCachePurgeEnabled()) return;

	const tagKeys = [...new Set([...tags].map(cacheTagKey))];
	if (tagKeys.length === 0) return;

	const redis = useRedis();
	const ttlSeconds = Math.ceil(getMilliseconds(env['CACHE_TTL'], 0) / 1000) * 2;
	const pipeline = redis.pipeline();

	for (const tagKey of tagKeys) {
		pipeline.sadd(tagKey, key, `${key}__expires_at`);
		if (ttlSeconds > 0) pipeline.expire(tagKey, ttlSeconds);
	}

	await pipeline.exec();
}

/**
 * Purge cached responses affected by a mutation on `collection`. Outside scoped mode the whole data
 * cache is flushed (legacy `cache.clear()` behavior). In scoped mode the bare collection tag (global
 * reads) is always purged alongside the resolved `valueTags` (the owner/partition slices the mutation
 * touched), leaving every other slice untouched. A `null` `valueTags` means "values couldn't be
 * resolved" → fall back to a full flush rather than risk leaving a stale value slice behind.
 */
export async function purgeCache(
	cache: Keyv,
	collection: string,
	valueTags: CacheTag[] | null = [],
	context: EventContext | null = null,
): Promise<void> {
	if (!scopedCachePurgeEnabled()) {
		await cache.clear();
		return;
	}

	if (valueTags === null) {
		await cache.clear();
		return;
	}

	const tags = (await emitter.emitFilter(
		'cache.purge',
		[{ collection }, ...valueTags],
		{ collection },
		context,
	)) as CacheTag[];

	const redis = useRedis();
	const tagKeys = [...new Set(tags.map(cacheTagKey))];
	const members = [...new Set((await Promise.all(tagKeys.map((tagKey) => redis.smembers(tagKey)))).flat())];

	if (members.length > 0) {
		await Promise.all(members.map((member) => cache.delete(member)));
	}

	await redis.del(...tagKeys);
}

function getKeyvInstance(store: Store, ttl: number | undefined, namespaceSuffix?: string): Keyv {
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
		config.store = new KeyvRedis(getRedisConnection());
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
	if (url) return url as string;

	const { host, port, username, password, db, tls } = getConfigFromEnv('REDIS') as Record<string, any>;

	return {
		socket: {
			host,
			...(port !== undefined && { port: Number(port) }),
			...(tls && { tls: true }),
		},
		...(username !== undefined && { username }),
		...(password !== undefined && { password }),
		...(db !== undefined && { database: Number(db) }),
	};
}
