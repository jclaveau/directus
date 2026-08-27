import type {
	ApiExtensionContext,
	ScopedCacheExtensionHandle,
} from '@directus/types';
import { getCache } from '../../cache.js';
import {
	composeScopedCachePaths,
	type FieldTypesByField,
	purgeScopedCache,
	scopedCachePurgeEnabled,
	scopedCacheTagsFromRows,
} from '../../scoped-cache.js';

/**
 * Build the `context.scopedCache` handle for a register-type extension's
 * registration context (hook/endpoint/operation), closing over that context's own
 * `getSchema` so a per-request schema override is honored. Lives in its own leaf
 * module so `getCache` (cache.js) and the purge engine (scoped-cache.js) can both be
 * imported without re-entering the `cache.js` ⇄ `scoped-cache.js` cycle.
 *
 * See `ScopedCacheExtensionHandle` for the contract and footgun.
 */
export function createScopedCacheExtensionHandle(
	getSchema: ApiExtensionContext['getSchema'],
): ScopedCacheExtensionHandle {
	return {
		async purgeForMutatedRows(collection, mutatedRows) {
			const { cache } = getCache();

			if (!cache) {
				return;
			}

			// Scoped purging off (memory store / CI): no tag index to target a slice,
			// so a bypassed write can only stay correct by dropping the whole data
			// cache. (The same fallback `purgeScopedCache` runs when scoped is off.)
			if (!scopedCachePurgeEnabled()) {
				await cache.clear();
				return;
			}

			const schema = await getSchema();
			const collectionSchema = schema.collections[collection];
			const scopeFields = collectionSchema?.scopedCacheFields ?? [];

			// A relational scope — an explicit dotted field, or an M2O field that
			// composes to a deeper terminal — can't be resolved from the mutated rows:
			// a raw row carries only the first-hop fk, not the terminal value the read
			// side pinned, so a flat fk tag would miss the real slice and leave it
			// stale. Fall back to a collection-wide purge (this collection's bare tag +
			// every slice, still sparing other collections).
			const hasRelationalScope =
				scopeFields.some((field) => field.includes('.'))
				|| composeScopedCachePaths(schema, collection).length > 0;

			if (hasRelationalScope) {
				await purgeScopedCache(cache, collection, null);
				return;
			}

			// The primary key pins on every collection, declared or not, so a bypassed
			// write owes its key slices too — a read of that row pinned nothing else.
			// Deduped, since a project may also list its key as a scope field.
			const primaryKeyField = collectionSchema?.primary;

			const pinnedFields = primaryKeyField === undefined
				? scopeFields
				: [...new Set([primaryKeyField, ...scopeFields])];

			const fieldTypes: FieldTypesByField = Object.fromEntries(
				pinnedFields.map((field) => [field, collectionSchema?.fields[field]?.type]),
			);

			// 'coarse': a row missing a pinned field yields null → `purgeScopedCache`
			// does a collection-wide purge (fail-safe), never a silently-stale slice.
			// With every row resolved it returns the exact touched slices (surgical).
			// That now covers a row handed over without its primary key.
			const tags = scopedCacheTagsFromRows(
				collection,
				pinnedFields,
				mutatedRows,
				'coarse',
				fieldTypes,
			);

			await purgeScopedCache(cache, collection, tags);
		},
	};
}
