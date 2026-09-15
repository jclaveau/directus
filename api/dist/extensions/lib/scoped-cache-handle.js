import { composeScopedCachePaths, purgeScopedCache, scopedCachePurgeEnabled, scopedCacheTagsFromRows } from "../../scoped-cache.js";
import { getCache } from "../../cache.js";

//#region src/extensions/lib/scoped-cache-handle.ts
/**
* Build the `context.scopedCache` handle for a register-type extension's
* registration context (hook/endpoint/operation), closing over that context's own
* `getSchema` so a per-request schema override is honored. Lives in its own leaf
* module so `getCache` (cache.js) and the purge engine (scoped-cache.js) can both be
* imported without re-entering the `cache.js` ⇄ `scoped-cache.js` cycle.
*
* See `ScopedCacheExtensionHandle` for the contract and footgun.
*/
function createScopedCacheExtensionHandle(getSchema) {
	return { async purgeForMutatedRows(collection, mutatedRows) {
		const { cache } = getCache();
		if (!cache) return;
		if (!scopedCachePurgeEnabled()) {
			await cache.clear();
			return;
		}
		const schema = await getSchema();
		const collectionSchema = schema.collections[collection];
		const scopeFields = collectionSchema?.scopedCacheFields ?? [];
		if (scopeFields.some((field) => field.includes(".")) || composeScopedCachePaths(schema, collection).length > 0) {
			await purgeScopedCache(cache, collection, null);
			return;
		}
		const primaryKeyField = collectionSchema?.primary;
		const pinnedFields = primaryKeyField === void 0 ? scopeFields : [...new Set([primaryKeyField, ...scopeFields])];
		await purgeScopedCache(cache, collection, scopedCacheTagsFromRows(collection, pinnedFields, mutatedRows, "coarse", Object.fromEntries(pinnedFields.map((field) => [field, collectionSchema?.fields[field]?.type]))));
	} };
}

//#endregion
export { createScopedCacheExtensionHandle };