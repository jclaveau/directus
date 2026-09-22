import type {
	ReadMeta,
	ScopedCacheFingerprint,
	ScopedCacheTag,
} from '@directus/types';
import { scopedCacheTagsOfFingerprints } from './fingerprint.js';

/** What a read carries besides the dependency itself. */
type ScopedCacheReadMetaRest = Omit<
	ReadMeta,
	'scopedCacheFingerprints' | 'scopedCacheTags'
>;

/**
 * A read's meta, keyed on the fingerprints the read depends on.
 *
 * The flat `scopedCacheTags` is derived on demand rather than carried, so a
 * consumer able to read the fingerprints keeps the AND and one that isn't pays
 * for the flat form only when it asks. Derived once: a hook reading it and the
 * fill reading it after get the same array.
 */
export function scopedCacheReadMeta(
	scopedCacheFingerprints: ScopedCacheFingerprint[],
	rest: ScopedCacheReadMetaRest = {},
): ReadMeta {
	let derivedScopedCacheTags: ScopedCacheTag[] | undefined;

	return {
		...rest,
		scopedCacheFingerprints,
		get scopedCacheTags(): ScopedCacheTag[] {
			derivedScopedCacheTags ??=
				scopedCacheTagsOfFingerprints(scopedCacheFingerprints);

			return derivedScopedCacheTags;
		},
	};
}
