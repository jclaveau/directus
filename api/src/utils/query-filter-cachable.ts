import type { Filter } from '@directus/types';
import { filter_has_now } from './permissions-cachable.js';

/**
 * Whether it's worth caching a read whose ad-hoc query filter carries `$NOW`.
 * NOT a staleness guard: `sanitizeQuery` resolves `$NOW` to a concrete `Date`
 * before the cache key is built, so each request already keys distinctly and
 * never serves a stale HIT. The point is hygiene — such a read's key never
 * recurs, so caching it only writes a never-hit entry (Redis bloat, a bloated
 * scoped-purge tag set, skewed stats). Skip it. See [[query-now-not-poison]].
 */
export function queryFilterCachable(filter: Filter | null | undefined): boolean {
	if (!filter) {
		return true;
	}

	// `filter_has_now` throws on a nested null (`Object.entries(null)`), reachable
	// via a JSON filter like `{"f":{"_eq":null}}`. A runnable-but-odd filter must not
	// 500 through this gate — treat an unwalkable filter as cacheable (static value,
	// no resolvable `$NOW`).
	try {
		return !filter_has_now(filter);
	}
	catch {
		return true;
	}
}
