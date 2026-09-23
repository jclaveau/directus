import type { ReadMeta, ScopedCacheFingerprint } from '@directus/types';

/** What a read carries besides the dependency itself. */
type ScopedCacheReadMetaRest = Omit<ReadMeta, 'scopedCacheFingerprints'>;

/**
 * A read's meta, keyed on the fingerprints the read depends on.
 *
 * Fingerprints and nothing else: a legacy tag is a rendering of one, taken in
 * `respond` for the dev headers and the telemetry, and a consumer handed a flat
 * list of them would have lost the AND that makes a fingerprint a slice rather
 * than a collection.
 */
export function scopedCacheReadMeta(
	scopedCacheFingerprints: readonly ScopedCacheFingerprint[],
	rest: ScopedCacheReadMetaRest = {},
): ReadMeta {
	return { ...rest, scopedCacheFingerprints };
}
