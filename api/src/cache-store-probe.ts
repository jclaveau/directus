import { randomUUID } from 'node:crypto';
import type { Keyv } from 'keyv';

/**
 * Whether the response store can actually drop an entry right now.
 *
 * Keyv reports a store error by emitting `error` and answering `undefined`, so a
 * failed `delete` is indistinguishable from a successful one at the call site —
 * which is what let a drain clear its records while purging nothing, and would
 * let an eviction report gone an entry it never reached. A write read back is
 * the one answer that cannot be swallowed.
 *
 * The probe rides the cache's own namespace and carries a short ttl, so a process
 * that dies between the write and the delete leaves nothing behind for long.
 *
 * One key per call: every fill-guard eviction probes, and two probes sharing a
 * key read each other's delete as a swallowed write — a false negative that
 * records a pending purge for a fill that was evicted fine, and the drain then
 * purges the whole slice (https://github.com/jclaveau/directus/issues/507).
 */
export async function cacheStoreDropsEntries(cache: Keyv): Promise<boolean> {
	const probeKey = `__cache_store_probe:${randomUUID()}`;

	try {
		await cache.set(probeKey, 1, 30_000);

		if (await cache.get(probeKey) !== 1) {
			return false;
		}

		// Only once it is known to be there: a store that swallowed the write has
		// nothing to clean up, and the delete would be swallowed too.
		await cache.delete(probeKey);
		return true;
	}
	catch {
		// A store that throws rather than swallowing is just as unusable.
		return false;
	}
}
