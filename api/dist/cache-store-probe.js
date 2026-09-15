//#region src/cache-store-probe.ts
/**
* Whether the response store can actually drop an entry right now.
*
* Keyv reports a store error by emitting `error` and answering `undefined`, so a
* failed `delete` is indistinguishable from a successful one at the call site —
* which is what let a drain clear its records while purging nothing, and would
* let an eviction report gone an entry it never reached. A write read back is
* the one answer that cannot be swallowed.
*
* The probe rides the cache's own namespace and carries a short ttl, so a process
* that dies between the write and the delete leaves nothing behind for long.
*/
async function cacheStoreDropsEntries(cache) {
	const probeKey = "__cache_store_probe";
	try {
		await cache.set(probeKey, 1, 3e4);
		if (await cache.get(probeKey) !== 1) return false;
		await cache.delete(probeKey);
		return true;
	} catch {
		return false;
	}
}

//#endregion
export { cacheStoreDropsEntries };