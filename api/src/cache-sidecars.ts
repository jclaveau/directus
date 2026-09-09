/**
 * A cached response is stored as three keys: the payload and two sidecars,
 * carrying what a HIT needs without a second read. `respond` writes them, the
 * cache middleware and the entry endpoint read them, `evictCacheEntry` drops
 * them together.
 *
 * Their names live in a module of their own because the scoped cache has to
 * recognise a sidecar as well — a purge must not count one as an eviction of its
 * own, nor name one as an entry left stale — and `cache.ts` already imports
 * `scoped-cache/purge.ts`, so the shared vocabulary has to sit below both.
 */

const EXPIRES_AT_SUFFIX = '__expires_at';
const TAGS_SUFFIX = '__tags';

/** Where a HIT reads an entry's age, TTL and expiry from. */
export function cacheExpiresAtKey(redisKey: string): string {
	return `${redisKey}${EXPIRES_AT_SUFFIX}`;
}

/** The dev-only sibling holding an entry's scoped-cache tags. */
export function cacheTagsKey(redisKey: string): string {
	return `${redisKey}${TAGS_SUFFIX}`;
}

/** The entry a sidecar belongs to, or null when the key is not one. */
export function cacheSidecarOwner(member: string): string | null {
	const suffix = [EXPIRES_AT_SUFFIX, TAGS_SUFFIX]
		.find((candidate) => member.endsWith(candidate));

	return suffix === undefined
		? null
		: member.slice(0, -suffix.length);
}
