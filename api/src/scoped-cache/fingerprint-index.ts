import type { SchemaOverview } from '@directus/types';
import type { CollectionKey } from '../permissions/modules/process-ast/types.js';
import {
	escapeScopedCacheFingerprintGlob,
	escapeScopedCacheFingerprintToken,
	parseScopedCacheFingerprint,
	renderScopedCacheFingerprint,
	type ScopedCacheFingerprint,
} from './fingerprint.js';
import { scopedCacheIndexPrefix } from './pins.js';

/**
 * The key of the set a fingerprint is filed in, and of the set a write reads back.
 *
 * One set per collection would work and is what correctness asks for: every
 * fingerprint of that collection is tested against every row written to it. It is
 * the SIZE that does not work — a collection holding a million cached reads is a
 * million members to walk per written row. So the set is split by the one pin a
 * read of a scoped collection almost always carries, and a write always knows: the
 * row's value at the index path. A write then reads its own set and the bare one,
 * and never sees a fingerprint filed under somebody else's value.
 *
 * The split is an optimisation, never a bound: a fingerprint pinning nothing at
 * that path goes bare, and the bare set is read by every write to the collection.
 *
 * `indexPin` is what the split is keyed by — `<path>=<value>`, or empty for the
 * bare set. It never leaves this file: a caller asks for the keys of the sets it
 * has to write or read, not for the pin naming one.
 */
function scopedCacheIndexKey(
	collection: CollectionKey,
	indexPin: string,
): string {
	return `${scopedCacheIndexPrefix()}fingerprint:${collection}:${indexPin}`;
}

/**
 * The glob matching every set one collection's fingerprints are filed in — the
 * bare one and every split the index path produced.
 *
 * What a collection-wide purge reads, and the reason it needs no registry of the
 * sets a collection owns: a registry would be a second write on every fill, which
 * is the cost the split exists to avoid, and this purge is the fail-safe rather
 * than the hot path.
 *
 * The trailing colon bounds it. The key is `fingerprint:<collection>:<indexPin>`
 * and a collection name carries no colon, so a pattern ending at that one cannot
 * reach a longer name this one is a prefix of.
 */
export function scopedCacheCollectionIndexGlob(
	collection: CollectionKey,
): string {
	const matched = escapeScopedCacheFingerprintGlob(collection);

	return `${scopedCacheIndexPrefix()}fingerprint:${matched}:*`;
}

/**
 * The path a collection's cached reads are indexed by: the chain to the value
 * they belong to, followed to the end.
 *
 * A scope field naming an M2O whose target scopes too is a hop, not a bound: the
 * read pins the path THROUGH it, so `zone` leads to `zone.region` and on to
 * `zone.region.owner`, the column the row finally belongs to. The deepest such
 * path is the one that splits best — every slot of one region shares `zone`, and
 * only the terminal tells one index value from another.
 *
 * The chain ends where the hops do: at a scope field naming no relation, or one
 * whose target declares no scope of its own and is pinned by its key alone. Two
 * chains of the same depth are settled by declaration order, so the field a
 * collection names first is the one it is taken to belong to.
 */
export function scopedCacheIndexPath(
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
 * The pin naming nothing, whose set every write to the collection reads.
 */
const SCOPED_CACHE_BARE_PIN = '';

/**
 * The keys of the sets one fingerprint is filed in: one per value it pins the
 * index path to.
 *
 * A read bounded to a list of values depends on each of them and is dropped by a
 * write to any one, so it is filed under each — the same OR an `_in` already
 * carries, kept as the only OR the layout has left.
 */
export function scopedCacheFingerprintIndexKeys(
	fingerprint: ScopedCacheFingerprint,
	indexPath: string | null,
): string[] {
	const { collection } = fingerprint;

	if (indexPath === null) {
		return [scopedCacheIndexKey(collection, SCOPED_CACHE_BARE_PIN)];
	}

	const pinnedValues = Object.hasOwn(fingerprint.pinnedScope, indexPath)
		? fingerprint.pinnedScope[indexPath]
		: undefined;

	if (pinnedValues === undefined || pinnedValues.length === 0) {
		return [scopedCacheIndexKey(collection, SCOPED_CACHE_BARE_PIN)];
	}

	return pinnedValues.map((pinnedValue) => {
		return scopedCacheIndexKey(
			collection,
			`${indexPath}=${escapeScopedCacheFingerprintToken(pinnedValue)}`,
		);
	});
}

/**
 * The keys of the sets a write reads back: the bare one, and the one each of its
 * rows' values at the index path names.
 *
 * The row is read as a fingerprint of its own, so the value it pins there is
 * looked up the same way a cached read's is. A row whose index path does not
 * resolve — the ancestor was deleted, or the write never carried it — reads the
 * bare set alone, and the sets it cannot name are left to the collection-wide
 * purge. The collection is the written one rather than the rows', so an empty
 * write still names the bare set.
 */
export function scopedCacheRowIndexKeys(
	collection: CollectionKey,
	rowFingerprints: readonly ScopedCacheFingerprint[],
	indexPath: string | null,
): string[] {
	const indexKeys = new Set<string>([
		scopedCacheIndexKey(collection, SCOPED_CACHE_BARE_PIN),
	]);

	if (indexPath === null) {
		return [...indexKeys];
	}

	for (const rowFingerprint of rowFingerprints) {
		const pinnedValues = Object.hasOwn(rowFingerprint.pinnedScope, indexPath)
			? rowFingerprint.pinnedScope[indexPath] ?? []
			: [];

		for (const pinnedValue of pinnedValues) {
			indexKeys.add(scopedCacheIndexKey(
				collection,
				`${indexPath}=${escapeScopedCacheFingerprintToken(pinnedValue)}`,
			));
		}
	}

	return [...indexKeys];
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
