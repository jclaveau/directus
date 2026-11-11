import { AsyncLocalStorage } from 'node:async_hooks';
import type { ScopedCacheFingerprint } from '@directus/types';

/**
 * What the scoped-cache purges of one request reached, for the
 * CACHE_PURGED_TAGS_HEADER: the request's own service's, and those of the services
 * its nested writes and hooks built, which wait for its commit (#363). `null` once
 * one of them flushed the whole namespace.
 */
export type ScopedCachePurgedRecord = {
	purged: ScopedCacheFingerprint[] | null;
};

export const scopedCachePurgedStore =
	new AsyncLocalStorage<ScopedCachePurgedRecord>();

export function recordScopedCachePurged(
	purged: ScopedCacheFingerprint[] | null,
): void {
	const purgedRecord = scopedCachePurgedStore.getStore();

	if (purgedRecord === undefined || purgedRecord.purged === null) {
		return;
	}

	purgedRecord.purged = purged === null
		? null
		: [...purgedRecord.purged, ...purged];
}
