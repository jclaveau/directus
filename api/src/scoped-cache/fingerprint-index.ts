import type { SchemaOverview } from '@directus/types';
import type { CollectionKey } from '../permissions/modules/process-ast/types.js';
import {
	escapeScopedCacheFingerprintToken,
	parseScopedCacheFingerprint,
	renderScopedCacheFingerprint,
	type ScopedCacheFingerprint,
} from './fingerprint.js';
import { scopedCacheIndexPrefix } from './tags.js';

/**
 * The set a fingerprint is filed in, and the set a write reads back.
 *
 * One set per collection would work and is what correctness asks for: every
 * fingerprint of that collection is tested against every row written to it. It is
 * the SIZE that does not work — a collection holding a million cached reads is a
 * million members to walk per written row. So the set is split by the one pair a
 * read of a scoped collection almost always pins, and a write always knows: the
 * row's bucket value. A write then reads its own bucket's set and the bare one,
 * and never sees a fingerprint filed under somebody else's bucket value.
 *
 * The split is an optimisation, never a bound: a fingerprint pinning no bucket
 * value goes bare, and the bare set is read by every write to the collection.
 */
export function scopedCacheFingerprintIndexKey(
	collection: CollectionKey,
	bucket: string,
): string {
	return `${scopedCacheIndexPrefix()}idx:${collection}:${bucket}`;
}

/**
 * The path a collection's cached reads are bucketed by: the chain to its bucket
 * value, followed to the end.
 *
 * A scope field naming an M2O whose target scopes too is a hop, not a bound: the
 * read pins the path THROUGH it, so `zone` leads to `zone.region` and on to
 * `zone.region.owner`, the column the row finally belongs to. The deepest such
 * path is the one that splits best — every slot of one region shares `zone`, and
 * only the terminal tells one bucket value from another.
 *
 * The chain ends where the hops do: at a scope field naming no relation, or one
 * whose target declares no scope of its own and is pinned by its key alone. Two
 * chains of the same depth are settled by declaration order, so the field a
 * collection names first is the one it is taken to belong to.
 */
export function scopedCacheBucketPath(
	schema: SchemaOverview,
	collection: CollectionKey,
): string | null {
	const walkRelations = (
		current: CollectionKey,
		prefix: string,
		visited: ReadonlySet<CollectionKey>,
	): string | null => {
		if (visited.has(current)) {
			return null;
		}

		const seenCollections = new Set(visited).add(current);
		let deepestPath: string | null = null;

		for (const field of schema.collections[current]?.scopedCacheFields ?? []) {
			// A composed path is already the chain, read off an ancestor rather than
			// walked to: following it again would count the same hops twice.
			if (field.includes('.')) {
				continue;
			}

			const relationPath = prefix === ''
				? field
				: `${prefix}.${field}`;

			const targetRelation = schema.relations.find((relation) => {
				return relation.collection === current && relation.field === field;
			})?.related_collection;

			const targetScopes =
				(schema.collections[targetRelation ?? '']?.scopedCacheFields ?? [])
					.length > 0;

			const candidatePath = targetScopes && targetRelation
				? walkRelations(targetRelation, relationPath, seenCollections)
					?? relationPath
				: relationPath;

			if (
				deepestPath === null
				|| candidatePath.split('.').length > deepestPath.split('.').length
			) {
				deepestPath = candidatePath;
			}
		}

		return deepestPath;
	};

	return walkRelations(collection, '', new Set());
}

/**
 * A fingerprint pinning no bucket value, filed where every write to the
 * collection looks.
 */
export const SCOPED_CACHE_BARE_BUCKET = '';

/**
 * The sets one fingerprint is filed in: one per value it pins the bucket path to.
 *
 * A read bounded to a list of bucket values depends on each of them and is
 * dropped by a write to any one, so it is filed under each — the same OR an
 * `_in` already carries, kept as the only OR the layout has left.
 */
export function scopedCacheFingerprintBuckets(
	fingerprint: ScopedCacheFingerprint,
	bucketPath: string | null,
): string[] {
	if (bucketPath === null) {
		return [SCOPED_CACHE_BARE_BUCKET];
	}

	const bucketValues = fingerprint.pairs.get(bucketPath);

	if (bucketValues === undefined || bucketValues.length === 0) {
		return [SCOPED_CACHE_BARE_BUCKET];
	}

	return bucketValues.map((bucketValue) => {
		return `${bucketPath}=${escapeScopedCacheFingerprintToken(bucketValue)}`;
	});
}

/**
 * The sets a write reads back: the bare one, and the one its row's bucket value
 * names.
 *
 * The row is read as a fingerprint of its own, so the bucket value it pins is
 * looked up the same way a cached read's is. A row whose bucket path does not
 * resolve — the ancestor was deleted, or the write never carried it — reads the
 * bare set alone, and the other buckets it cannot name are left to the
 * collection-wide purge.
 */
export function scopedCacheRowBuckets(
	rowFingerprints: readonly ScopedCacheFingerprint[],
	bucketPath: string | null,
): string[] {
	const buckets = new Set<string>([SCOPED_CACHE_BARE_BUCKET]);

	if (bucketPath === null) {
		return [...buckets];
	}

	for (const rowFingerprint of rowFingerprints) {
		const bucketValues = rowFingerprint.pairs.get(bucketPath) ?? [];

		for (const bucketValue of bucketValues) {
			buckets.add(
				`${bucketPath}=${escapeScopedCacheFingerprintToken(bucketValue)}`,
			);
		}
	}

	return [...buckets];
}

/**
 * A set member: the serialised fingerprint that has to match, and the cache key it
 * protects.
 *
 * Both in one member so the match needs nothing but the set itself, and so a key
 * cached under two different query cases is two members rather than one entry
 * whose query cases have been merged into an OR.
 *
 * `|` splits them, and a fingerprint escapes every `|` it carries, so the split is
 * on the FIRST one however the cache key is spelled. This is the one place a
 * fingerprint leaves Node as a string; `parseScopedCacheIndexMember` is the one
 * place it comes back.
 */
export function renderScopedCacheIndexMember(
	fingerprint: ScopedCacheFingerprint,
	key: string,
): string {
	return `${renderScopedCacheFingerprint(fingerprint)}|${key}`;
}

export function parseScopedCacheIndexMember(
	member: string,
): { fingerprint: ScopedCacheFingerprint; key: string } {
	const splitAt = member.indexOf('|');

	if (splitAt === -1) {
		return { fingerprint: parseScopedCacheFingerprint(member), key: '' };
	}

	return {
		fingerprint: parseScopedCacheFingerprint(member.slice(0, splitAt)),
		key: member.slice(splitAt + 1),
	};
}
