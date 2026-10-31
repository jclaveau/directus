import { useLogger } from "../../logger/index.js";
import { scopedCacheCollectionPinsFromRows } from "../../scoped-cache/pins.js";
import { composeScopedCachePaths } from "../../scoped-cache/paths.js";
import { scopedCacheFingerprintOf } from "../../scoped-cache/fingerprint.js";
import { scopedCachePurgeEnabled } from "../../scoped-cache/config.js";
import { scopedCacheIndexPath } from "../../scoped-cache/index-path.js";
import { scopedCacheMutatedFingerprints } from "../../scoped-cache/mutated-rows.js";
import database_default from "../../database/index.js";
import { purgeScopedCache } from "../../scoped-cache/purge.js";
import { ItemScopedCacheService } from "../../scoped-cache/item-scoped-cache-service.js";
import "../../scoped-cache/index.js";
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
		const hasRelationalScope = scopeFields.some((field) => field.includes(".")) || composeScopedCachePaths(schema, collection).length > 0;
		const primaryKeyField = collectionSchema?.primary;
		if (hasRelationalScope) {
			if (primaryKeyField === void 0 || mutatedRows.some((mutatedRow) => {
				const mutatedKey = mutatedRow[primaryKeyField];
				return mutatedKey === void 0 || mutatedKey === null;
			})) {
				await purgeScopedCache(cache, collection, null);
				return;
			}
			const distinctKeys = [...new Set(mutatedRows.map((mutatedRow) => {
				return mutatedRow[primaryKeyField];
			}))];
			let scopedCacheSnapshot;
			try {
				scopedCacheSnapshot = await new ItemScopedCacheService(collection, schema, database_default(), cache, null).snapshot(distinctKeys);
			} catch (error) {
				useLogger().warn(error, `[scoped-cache] purgeForMutatedRows could not read back ${collection}, purging it whole`);
				await purgeScopedCache(cache, collection, null);
				return;
			}
			const snapshotFingerprints = scopedCacheMutatedFingerprints(scopedCacheSnapshot);
			if (snapshotFingerprints === null || scopedCacheSnapshot.rows.length < distinctKeys.length) {
				await purgeScopedCache(cache, collection, null);
				return;
			}
			await purgeScopedCache(cache, collection, [], null, {
				rowFingerprints: snapshotFingerprints,
				indexPath: scopedCacheIndexPath(schema, collection)
			});
			return;
		}
		const pinnedFields = primaryKeyField === void 0 ? scopeFields : [...new Set([primaryKeyField, ...scopeFields])];
		const fieldTypes = Object.fromEntries(pinnedFields.map((field) => [field, collectionSchema?.fields[field]?.type]));
		const rowFingerprints = [];
		for (const mutatedRow of mutatedRows) {
			const rowPins = scopedCacheCollectionPinsFromRows(collection, pinnedFields, [mutatedRow], "coarse", fieldTypes);
			if (rowPins === null) {
				await purgeScopedCache(cache, collection, null);
				return;
			}
			rowFingerprints.push(scopedCacheFingerprintOf(collection, rowPins));
		}
		if (pinnedFields.length === 0 || rowFingerprints.length === 0) {
			await purgeScopedCache(cache, collection, []);
			return;
		}
		await purgeScopedCache(cache, collection, [], null, {
			rowFingerprints,
			indexPath: scopedCacheIndexPath(schema, collection)
		});
	} };
}

//#endregion
export { createScopedCacheExtensionHandle };