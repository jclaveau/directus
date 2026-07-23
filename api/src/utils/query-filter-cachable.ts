import type { Filter } from '@directus/types';
import { filter_has_now } from './permissions-cachable.js';

/**
 * Whether a read's ad-hoc query filter is safe to cache. `$NOW` (and its
 * adjusted `$NOW(...)` forms) resolves to the current time at read, but the
 * cache key keeps the literal `$NOW` string — so the first request's "now"
 * freezes and is served stale for the whole TTL. The query-side twin of
 * `permissionsCachable`, which gates the permission filter but never the user's.
 */
export function queryFilterCachable(filter: Filter | null | undefined): boolean {
	if (!filter) {
		return true;
	}

	return !filter_has_now(filter);
}
