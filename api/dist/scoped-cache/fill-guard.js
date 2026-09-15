import { useLogger } from "../logger/index.js";
import { useRedis } from "../redis/lib/use-redis.js";
import { redisConfigAvailable } from "../redis/utils/redis-config-available.js";
import "../redis/index.js";
import { scopedCachePurgeEnabled } from "./config.js";
import { earlierScopedCacheEpoch } from "./tags.js";
import { useEnv } from "@directus/env";

//#region src/scoped-cache/fill-guard.ts
const env = useEnv();
const SCOPED_CACHE_EPOCH_TTL_SECONDS = 1440 * 60;
/**
* A per-collection purge counter, bumped every time that collection's tags are
* dropped. `*` is the wholesale entry, bumped by a flush that names no collection.
*/
function scopedCacheEpochKey(collection) {
	return `${env["CACHE_NAMESPACE"]}:epoch:${collection}`;
}
/**
* Read the purge counters of the collections a read depends on.
*
* A read's tags reach the index only in `respond`, long after the rows were fetched:
* a purge landing in between finds nothing to drop, and the fill then stores rows it
* already superseded — stale for the whole TTL, and (its tag sets having just been
* deleted) unreachable to every later purge. Comparing the counter captured before
* the query against the one at fill time is what closes that window.
*/
async function readScopedCacheEpochs(collections) {
	if (!env["CACHE_ENABLED"] || !scopedCachePurgeEnabled() || !redisConfigAvailable()) return {};
	const names = [...new Set([...collections, "*"])];
	const values = await useRedis().mget(names.map(scopedCacheEpochKey)).catch(() => null);
	if (values === null) return {};
	return Object.fromEntries(names.map((name, index) => [name, values[index] ?? null]));
}
/**
* Bump the counters of the collections a purge just dropped tags for. Expiring, so
* a collection nothing writes to stops costing a key; a read whose counter expired
* between capture and fill reads `null` on both sides and caches, which is right —
* nothing purged it in between.
*/
async function bumpScopedCacheEpochs(collections) {
	if (!scopedCachePurgeEnabled() || !redisConfigAvailable()) return;
	const names = [...new Set(collections)];
	if (names.length === 0) return;
	try {
		const pipeline = useRedis().pipeline();
		for (const name of names) {
			pipeline.incr(scopedCacheEpochKey(name));
			pipeline.expire(scopedCacheEpochKey(name), SCOPED_CACHE_EPOCH_TTL_SECONDS);
		}
		const refused = (await pipeline.exec())?.find(([error]) => error !== null)?.[0];
		if (refused) throw refused;
	} catch (error) {
		useLogger().warn(error, `[scoped-cache] purge counters not bumped, fills racing this purge are unguarded: ${error}`);
	}
}
/**
* Fold in the counters a read hook handed over, keeping the read's OWN capture
* wherever it has one.
*
* Not the rule the collector uses to merge two DECLARED counters, and it does not
* need to be: the read's capture was taken before its query, so it is earlier than
* anything a hook could hand over, with no comparison required. A collection the
* capture never named has no such guarantee, which is why the hook's value is taken
* there and compared where two of them meet.
*/
function foldHandedOverScopedCacheEpochs(captured, handedOver) {
	const folded = { ...captured };
	for (const [collection, epoch] of Object.entries(handedOver)) if (collection in folded === false) folded[collection] = epoch;
	return folded;
}
/**
* Merge the captures of two reads whose results become ONE cached entry — the roots
* of a GraphQL query, say. The EARLIER reading wins per collection: a root reading
* `E+1` where another read `E` means a purge landed between them, and only the
* earlier value makes the post-fill comparison notice.
*/
function mergeScopedCacheEpochs(into, from) {
	for (const [collection, epoch] of Object.entries(from)) into[collection] = collection in into ? earlierScopedCacheEpoch(into[collection], epoch) : epoch;
}
/**
* The collections a response is tagged with that its capture never covered — so a
* purge of them landing mid-read passes the post-fill comparison unnoticed, and the
* entry would be stored already stale under an index that purge has swept.
*
* A read hook's `scopeTo` is how one gets there: it names any collection it likes,
* and it runs after the capture was taken. There is no capturing it late, since the
* check needs a value from BEFORE the query — so the caller refuses the fill.
*
* `*` rides every capture, so its presence is what says the guard ran at all.
* Without it (no redis, purging off, a read that opted out) nothing is guarded
* anyway, and refusing the whole cache over that would be a far worse trade.
*/
function scopedCacheCollectionsWithoutGuard(captured, tags) {
	if (captured === void 0 || "*" in captured === false) return [];
	return [...new Set(tags.map((tag) => tag.collection))].filter((collection) => collection in captured === false);
}
/**
* The collection whose counter moved between a read's capture and now, or
* `undefined` when none did.
*
* Called AFTER the entry is written, which is the comparison that closes the
* window: a purge that started after the pre-fill check either read the tag sets
* before this key was filed, or deleted the key between the value and its sidecar,
* and either way the entry outlives it. A purge bumps the counters BEFORE it
* sweeps, so re-reading them here catches every such interleaving.
*/
async function scopedCacheSweptDuringFill(captured) {
	const afterFill = await readScopedCacheEpochs(Object.keys(captured));
	return Object.entries(captured).find(([collection, epoch]) => {
		return afterFill[collection] !== epoch;
	})?.[0];
}

//#endregion
export { bumpScopedCacheEpochs, foldHandedOverScopedCacheEpochs, mergeScopedCacheEpochs, readScopedCacheEpochs, scopedCacheCollectionsWithoutGuard, scopedCacheSweptDuringFill };