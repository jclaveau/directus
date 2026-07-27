import type {
	ApiExtensionContext,
	ScopedCacheExtensionHandle,
	Type,
} from '@directus/types';
import { getCache } from '../../cache.js';
import {
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

			// Scoped purging off (memory store / CI): no tag index to target a
			// slice, so a bypassed write can only stay correct by dropping the
			// whole data cache.
			if (!scopedCachePurgeEnabled()) {
				await cache.clear();
				return;
			}

			const schema = await getSchema();
			const collectionSchema = schema.collections[collection];
			const scopeFields = collectionSchema?.scopedCacheFields ?? [];

			const fieldTypes: Record<string, Type | undefined> = Object.fromEntries(
				scopeFields.map((field) => [field, collectionSchema?.fields[field]?.type]),
			);

			// 'skip' best-effort drops a row missing a scope field rather than
			// coarsening the whole purge; no `scopeFields` → `[]` → a bare
			// collection-tag purge (global reads).
			const tags = scopedCacheTagsFromRows(
				collection,
				scopeFields,
				mutatedRows,
				'skip',
				fieldTypes,
			);

			await purgeScopedCache(cache, collection, tags);
		},
	};
}
