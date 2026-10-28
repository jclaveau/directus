import { redisScopedCacheStore } from "./redis-store.js";

//#region src/scoped-cache/store.ts
/**
* The store the scoped cache is running on.
*
* One store today, picked by nothing: scoped mode is refused unless
* `CACHE_STORE=redis` (`scopedCachePurgeEnabled`), so the choice this function
* would make is already made upstream of every caller. It exists so that adding a
* store is a branch here plus an implementation, and so that no caller holds a
* client.
*/
function useScopedCacheStore() {
	return redisScopedCacheStore();
}

//#endregion
export { useScopedCacheStore };