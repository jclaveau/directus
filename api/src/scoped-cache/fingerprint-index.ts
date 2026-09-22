import type { CollectionKey, SchemaOverview } from '@directus/types';
import {
	escapeScopedCacheFingerprintToken,
	parseScopedCacheFingerprint,
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
 * row's owner. A write then reads its own owner's set and the bare one, and never
 * sees a fingerprint owned by somebody else.
 *
 * The split is an optimisation, never a bound: a fingerprint pinning no owner goes
 * bare, and the bare set is read by every write to the collection.
 */
export function scopedCacheFingerprintIndexKey(
	collection: CollectionKey,
	bucket: string,
): string {
	return `${scopedCacheIndexPrefix()}idx:${collection}:${bucket}`;
}

/**
 * The path a collection's cached reads are bucketed by: its ownership chain,
 * followed to the end.
 *
 * A scope field naming an M2O whose target scopes too is a hop, not a bound: the
 * read pins the path THROUGH it, so `zone` leads to `zone.region` and on to
 * `zone.region.owner`, the column the row finally belongs to. The deepest such
 * path is the one that splits best — every slot of one region shares `zone`, and
 * only the terminal tells one owner from another.
 *
 * The chain ends where the hops do: at a scope field naming no relation, or one
 * whose target declares no scope of its own and is pinned by its key alone. Two
 * chains of the same depth are settled by declaration order, so the field a
 * collection names first is the one it is taken to belong to.
 */
export function scopedCacheOwnerPath(
	schema: SchemaOverview,
	collection: CollectionKey,
): string | null {
	const walk = (
		current: CollectionKey,
		prefix: string,
		visited: ReadonlySet<CollectionKey>,
	): string | null => {
		if (visited.has(current)) {
			return null;
		}

		const seen = new Set(visited).add(current);
		let deepest: string | null = null;

		for (const field of schema.collections[current]?.scopedCacheFields ?? []) {
			// A composed path is already the chain, read off an ancestor rather than
			// walked to: following it again would count the same hops twice.
			if (field.includes('.')) {
				continue;
			}

			const path = prefix === ''
				? field
				: `${prefix}.${field}`;

			const target = schema.relations.find((relation) => {
				return relation.collection === current && relation.field === field;
			})?.related_collection;

			const targetScopes =
				(schema.collections[target ?? '']?.scopedCacheFields ?? []).length > 0;

			const candidate = targetScopes && target
				? walk(target, path, seen) ?? path
				: path;

			if (
				deepest === null
				|| candidate.split('.').length > deepest.split('.').length
			) {
				deepest = candidate;
			}
		}

		return deepest;
	};

	return walk(collection, '', new Set());
}

/**
 * A fingerprint pinning no owner, filed where every write to the collection looks.
 */
export const SCOPED_CACHE_BARE_BUCKET = '';

/**
 * The sets one fingerprint is filed in: one per value it pins the owner path to.
 *
 * A read bounded to a list of owners depends on each of them and is dropped by a
 * write to any one, so it is filed under each — the same OR an `_in` already
 * carries, kept as the only OR the layout has left.
 */
export function scopedCacheFingerprintBuckets(
	fingerprint: ScopedCacheFingerprint,
	ownerPath: string | null,
): string[] {
	if (ownerPath === null) {
		return [SCOPED_CACHE_BARE_BUCKET];
	}

	const owners = parseScopedCacheFingerprint(fingerprint).pairs.get(ownerPath);

	if (owners === undefined || owners.length === 0) {
		return [SCOPED_CACHE_BARE_BUCKET];
	}

	return owners.map((owner) => {
		return `${ownerPath}=${escapeScopedCacheFingerprintToken(owner)}`;
	});
}

/**
 * The sets a write reads back: the bare one, and the one its row's owner names.
 *
 * The row is read as a fingerprint of its own, so the owner it pins is looked up
 * the same way a cached read's is. A row whose owner path does not resolve — the
 * ancestor was deleted, or the write never carried it — reads the bare set alone,
 * and the owned sets it cannot name are left to the collection-wide purge.
 */
export function scopedCacheRowBuckets(
	rowFingerprints: readonly ScopedCacheFingerprint[],
	ownerPath: string | null,
): string[] {
	const buckets = new Set<string>([SCOPED_CACHE_BARE_BUCKET]);

	if (ownerPath === null) {
		return [...buckets];
	}

	for (const rowFingerprint of rowFingerprints) {
		const owners = parseScopedCacheFingerprint(rowFingerprint).pairs
			.get(ownerPath) ?? [];

		for (const owner of owners) {
			buckets.add(`${ownerPath}=${escapeScopedCacheFingerprintToken(owner)}`);
		}
	}

	return [...buckets];
}

/**
 * A set member: the fingerprint that has to match, and the cache key it protects.
 *
 * Both in one member so the match needs nothing but the set itself, and so a key
 * cached under two different bounds is two members rather than one entry whose
 * bounds have been merged into an OR.
 *
 * `|` splits them, and a fingerprint escapes every `|` it carries, so the split is
 * on the FIRST one however the cache key is spelled.
 */
export function renderScopedCacheIndexMember(
	fingerprint: ScopedCacheFingerprint,
	key: string,
): string {
	return `${fingerprint}|${key}`;
}

export function parseScopedCacheIndexMember(
	member: string,
): { fingerprint: ScopedCacheFingerprint; key: string } {
	const splitAt = member.indexOf('|');

	if (splitAt === -1) {
		return { fingerprint: member, key: '' };
	}

	return {
		fingerprint: member.slice(0, splitAt),
		key: member.slice(splitAt + 1),
	};
}
