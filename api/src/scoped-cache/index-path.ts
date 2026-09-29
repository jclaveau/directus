/**
 * Which of a collection's fields its cached reads are indexed by.
 *
 * The layer's side of the index split: it answers off the schema, and what a store
 * does with the answer — whether it splits at all, and what it names the split —
 * is the store's own (`redis-store.ts`).
 */

import type { SchemaOverview } from '@directus/types';
import type { CollectionKey } from '../permissions/modules/process-ast/types.js';

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
