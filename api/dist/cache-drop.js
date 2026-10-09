//#region src/cache-drop.ts
/**
* How many keys one UNLINK carries. Redis parses the whole argument list before it
* frees anything, so an unbounded list is a long single-threaded pause for every
* other client — the same reason the tag sweep is chunked.
*/
const CACHE_DROP_CHUNK_KEYS = 500;
/**
* The `@keyv/redis` store behind this cache, or null for any other store.
*
* `createKeyPrefix`, `getClient` and `namespace` are all public on `KeyvRedis`,
* but `Keyv` accepts any store, and the memory one has none of them — so this
* asks rather than assumes, and the caller keeps a path for the store that says
* no.
*/
function redisBackedCacheStore(cache) {
	const store = cache.store;
	if (typeof store?.createKeyPrefix !== "function") return null;
	if (typeof store?.getClient !== "function") return null;
	return store;
}
/**
* The key Redis holds a cache entry under, which carries BOTH namespaces: `Keyv`
* prefixes its own before handing the key down, and `KeyvRedis` prefixes the
* store's on top of that. Building it from one of the two names a key nothing
* ever wrote, and every command on it then answers as if the entry were gone.
*/
function rawCacheKey(cache, store, key) {
	return store.createKeyPrefix(`${cache.namespace}:${key}`, store.namespace);
}
/**
* How to name a cache entry to Redis directly, or null for a store that is not
* Redis: the memory one holds its entries where no Redis command reaches.
*/
function cacheEntryRawKeyOf(cache) {
	const store = redisBackedCacheStore(cache);
	if (store === null) return null;
	return (key) => rawCacheKey(cache, store, key);
}
/**
* Delete cache entries and report how many of them were actually there.
*
* A scoped purge over a slice with 200 entries used to send 200 deletes, one per
* key, and the count scaled with how much the cache held rather than with how much
* the mutation touched. Against redis they go as one UNLINK per 500 keys, whose
* reply is the exact number removed — better evidence than the per-key boolean it
* replaces, which had to read "no answer" as "it was there".
*/
async function dropCacheEntries(cache, keys) {
	if (keys.length === 0) return 0;
	const store = redisBackedCacheStore(cache);
	const client = store === null ? null : await store.getClient();
	if (store === null || typeof client?.unlink !== "function") return (await Promise.all(keys.map((key) => {
		return cache.delete(key);
	}))).filter((deleted) => deleted !== false).length;
	const rawKeys = keys.map((key) => rawCacheKey(cache, store, key));
	let dropped = 0;
	for (let at = 0; at < rawKeys.length; at += CACHE_DROP_CHUNK_KEYS) dropped += await client.unlink(rawKeys.slice(at, at + CACHE_DROP_CHUNK_KEYS));
	return dropped;
}

//#endregion
export { cacheEntryRawKeyOf, dropCacheEntries };