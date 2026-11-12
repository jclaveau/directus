import { AsyncLocalStorage } from 'node:async_hooks';
import type { ScopedCacheFingerprint } from '@directus/types';

/**
 * What the scoped-cache purges of one request reached, for the
 * CACHE_PURGED_TAGS_HEADER: every purgeScopedCache call it awaited, a nested
 * write's queued until its commit (#363) included. `null` once one of them
 * flushed the whole namespace. A purge ending after `respond` (an unawaited
 * action hook) is not named.
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
