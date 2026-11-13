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
const PINS_SUFFIX = '__pins';

/** Where a HIT reads an entry's age, TTL and expiry from. */
export function cacheExpiresAtKey(redisKey: string): string {
	return `${redisKey}${EXPIRES_AT_SUFFIX}`;
}

/** The dev-only sibling holding an entry's scoped-cache pins. */
export function cachePinsKey(redisKey: string): string {
	return `${redisKey}${PINS_SUFFIX}`;
}

/** The entry a sidecar belongs to, or null when the key is not one. */
export function cacheSidecarOwner(member: string): string | null {
	const suffix = [EXPIRES_AT_SUFFIX, PINS_SUFFIX]
		.find((candidate) => member.endsWith(candidate));

	return suffix === undefined
		? null
		: member.slice(0, -suffix.length);
}

/**
 * The labels the `__pins` sidecar holds, or null when it holds anything else — an
 * entry written before the sidecar listed them, or a store answering garbage —
 * so nothing flattens into a garbled header or listing.
 */
export function storedScopedCachePinLabels(stored: unknown): string[] | null {
	const pins = (stored as { pins?: unknown } | undefined)?.pins;

	if (!Array.isArray(pins) || pins.length === 0) {
		return null;
	}

	return pins.every((pin) => typeof pin === 'string')
		? pins
		: null;
}
