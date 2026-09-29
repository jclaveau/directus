import { useEnv } from '@directus/env';
import {
	redisConfigAvailable,
} from '../redis/index.js';
import { useScopedCacheStore } from './store.js';

const env = useEnv();

/**
 * Whether scoped cache purging is active. Requires the opt-in mode AND a store that
 * can hold the fingerprint→keys index. Any other config falls back to full flush.
 *
 * Here rather than beside the purge it gates: every file in this module asks it,
 * including the ones the purge itself depends on, and a predicate that answers from
 * the environment alone is what lets them without importing each other.
 */
export function scopedCachePurgeEnabled(): boolean {
	return (
		env['CACHE_AUTO_PURGE_MODE'] === 'scoped' &&
		env['CACHE_STORE'] === 'redis' &&
		scopedCacheIndexStoreAvailable()
	);
}

/**
 * Whether the store the index lives in is configured at all — the question a flush
 * or a recovery asks before it reaches for the index, scoped mode on or off, and
 * whatever `CACHE_STORE` the responses themselves are held in: an index written
 * under an earlier config outlives the switch, and is the flush's to sweep.
 *
 * Redis is the only store that can hold it today, so this is where that is decided,
 * and the one place in the module that asks about a client rather than about the
 * store.
 */
export function scopedCacheIndexStoreAvailable(): boolean {
	return redisConfigAvailable();
}

/**
 * Fail fast at startup on a store that cannot hold the index — what that means is
 * the store's own answer (`assertStoreSupported`), since only it knows which of
 * its clients can answer for the whole keyspace. Surfaced at boot rather than as a
 * mid-request stale HIT.
 */
export function assertScopedCacheStoreSupported(): void {
	if (scopedCachePurgeEnabled()) {
		useScopedCacheStore().assertStoreSupported();
	}
}
