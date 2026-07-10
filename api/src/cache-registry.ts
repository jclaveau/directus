import { useEnv } from '@directus/env';
import type Keyv from 'keyv';
import { redisConfigAvailable, useRedis } from './redis/index.js';
import { getMilliseconds } from './utils/get-milliseconds.js';

/**
 * A per-entry index of the response cache, kept in Redis next to the cached
 * values so the admin cache page can list what's cached per endpoint, count how
 * often each entry was served, and evict one entry (or a whole endpoint) when it
 * goes stale. Each cached response gets a sibling hash `<namespace>:entry:<key>`
 * with its request descriptor + a `hits` counter, expiring with the value it
 * describes so it self-cleans.
 *
 * Redis-only: the cache key is an opaque hash of `{version,user,path,query,ip}`
 * (get-cache-key.ts), so the endpoint a key maps to is recoverable only from this
 * sidecar. A memory store keeps no index — the page needs `CACHE_STORE=redis`.
 */

export interface CacheEntryRecord {
	key: string;
	path: string;
	method: string;
	user: string | null;
	createdAt: number;
	expiresAt: number | null;
	size: number;
	hits: number;
}

export interface CacheEntryDescriptor {
	key: string;
	path: string;
	method: string;
	user: string | null;
	createdAt: number;
	expiresAt: number | null;
	size: number;
}

// Only increment when the hash still exists, so a HIT on an entry whose sidecar
// already expired can't resurrect a hits-only orphan (no meta, no TTL).
const HIT_INCREMENT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
	return redis.call('HINCRBY', KEYS[1], 'hits', 1)
end
return 0
`;

export function cacheRegistryEnabled(): boolean {
	const env = useEnv();

	return (
		env['CACHE_STATS_ENABLED'] !== false &&
		env['CACHE_STORE'] === 'redis' &&
		redisConfigAvailable()
	);
}

function registryKeyPrefix(): string {
	return `${useEnv()['CACHE_NAMESPACE']}:entry:`;
}

function registryKey(key: string): string {
	return `${registryKeyPrefix()}${key}`;
}

/**
 * Record a freshly-cached response's descriptor. Re-registering (a re-cache after
 * purge/expiry) refreshes the descriptor + TTL but keeps `hits` — created lazily
 * by `recordCacheHit`, dropped with the hash when the entry expires. TTL mirrors
 * the value's so the sidecar can't outlive it; an unset `CACHE_TTL` leaves both
 * unbounded.
 */
export async function registerCacheEntry(
	entry: CacheEntryDescriptor,
): Promise<void> {
	if (!cacheRegistryEnabled()) {
		return;
	}

	const redis = useRedis();
	const hashKey = registryKey(entry.key);

	await redis.hset(hashKey, {
		path: entry.path,
		method: entry.method,
		user: entry.user ?? '',
		createdAt: String(entry.createdAt),
		expiresAt: entry.expiresAt === null
			? ''
			: String(entry.expiresAt),
		size: String(entry.size),
	});

	const ttlSeconds = Math.ceil(getMilliseconds(useEnv()['CACHE_TTL'], 0) / 1000);

	if (ttlSeconds > 0) {
		await redis.expire(hashKey, ttlSeconds);
	}
}

export async function recordCacheHit(key: string): Promise<void> {
	if (!cacheRegistryEnabled()) {
		return;
	}

	await useRedis().eval(HIT_INCREMENT_SCRIPT, 1, registryKey(key));
}

/**
 * Every cached entry's descriptor, newest first. SCAN the sidecar hashes (single-
 * node, like scoped-cache) then a pipelined HGETALL — the page is low-frequency, so
 * O(entries) is fine. A hash that expired mid-scan yields an empty HGETALL, dropped.
 */
export async function listCacheEntries(): Promise<CacheEntryRecord[]> {
	if (!cacheRegistryEnabled()) {
		return [];
	}

	const redis = useRedis();
	const prefix = registryKeyPrefix();
	const hashKeys: string[] = [];
	let cursor = '0';

	do {
		const [next, batch] = await redis.scan(
			cursor,
			'MATCH',
			`${prefix}*`,
			'COUNT',
			250,
		);

		cursor = next;
		hashKeys.push(...batch);
	}
	while (cursor !== '0');

	if (hashKeys.length === 0) {
		return [];
	}

	const pipeline = redis.pipeline();

	for (const hashKey of hashKeys) {
		pipeline.hgetall(hashKey);
	}

	const results = await pipeline.exec();
	const records: CacheEntryRecord[] = [];

	results?.forEach(([, value], index) => {
		const fields = value as Record<string, string> | null;

		if (!fields || fields['path'] === undefined) {
			return;
		}

		records.push({
			key: hashKeys[index]!.slice(prefix.length),
			path: fields['path'],
			method: fields['method'] ?? '',
			user: fields['user']
				? fields['user']
				: null,
			createdAt: Number(fields['createdAt'] ?? 0),
			expiresAt: fields['expiresAt']
				? Number(fields['expiresAt'])
				: null,
			size: Number(fields['size'] ?? 0),
			hits: Number(fields['hits'] ?? 0),
		});
	});

	return records.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Evict a single cached response: the value, its `__expires_at`/`__tags` siblings,
 * and the registry hash. Leaves scoped-cache tag-set membership — a dead member is
 * a no-op on the next purge and the tag sets self-expire.
 */
export async function evictCacheEntry(cache: Keyv, key: string): Promise<void> {
	await cache.delete(key);
	await cache.delete(`${key}__expires_at`);
	await cache.delete(`${key}__tags`);

	if (cacheRegistryEnabled()) {
		await useRedis().del(registryKey(key));
	}
}

/**
 * Evict every cached response for one endpoint path. Returns the count dropped.
 */
export async function evictCacheEntriesForPath(
	cache: Keyv,
	path: string,
): Promise<number> {
	const matching = (await listCacheEntries()).filter((entry) => entry.path === path);

	await Promise.all(matching.map((entry) => evictCacheEntry(cache, entry.key)));

	return matching.length;
}
