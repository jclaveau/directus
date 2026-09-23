import { useEnv } from '@directus/env';
import {
	redisConfigAvailable,
} from '../redis/index.js';
import { useScopedCacheStore } from './store.js';

const env = useEnv();

/**
 * Whether scoped (tag-based) cache purging is active. Requires the opt-in mode AND a
 * Redis cache store, since the tag→keys index lives in Redis sets. Any other config
 * falls back to full flush.
 *
 * Here rather than beside the purge it gates: every file in this module asks it,
 * including the ones the purge itself depends on, and a predicate that answers from
 * the environment alone is what lets them without importing each other.
 */
export function scopedCachePurgeEnabled(): boolean {
	return (
		env['CACHE_AUTO_PURGE_MODE'] === 'scoped' &&
		env['CACHE_STORE'] === 'redis' &&
		redisConfigAvailable()
	);
}

/**
 * Fail fast at startup on a store that cannot hold the index — what that means is
 * the store's own answer (`assertStoreSupported`), since only it knows which of
 * its clients can answer for the whole keyspace. Surfaced at boot rather than as a
 * mid-request stale HIT.
 */
export function assertScopedCacheRedisSupported(): void {
	if (scopedCachePurgeEnabled()) {
		useScopedCacheStore().assertStoreSupported();
	}
}
