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
* `createKeyPrefix`, `client` and `namespace` are all public on `KeyvRedis`, but
* `Keyv` accepts any store, and the memory one has none of them — so this asks
* rather than assumes, and the caller keeps a path for the store that says no.
*/
function redisBackedCacheStore(cache) {
	const store = cache.store;
	if (typeof store?.createKeyPrefix !== "function") return null;
	if (typeof store?.client?.unlink !== "function") return null;
	return store;
}
/**
* Delete cache entries and report how many of them were actually there.
*
* A scoped purge over a slice with 200 entries used to send 200 deletes, one per
* key, and the count scaled with how much the cache held rather than with how much
* the mutation touched. Against redis they go as one UNLINK per 500 keys, whose
* reply is the exact number removed — better evidence than the per-key boolean it
* replaces, which had to read "no answer" as "it was there".
*
* The raw key carries BOTH namespaces: `Keyv` prefixes its own before handing the
* key down, and `KeyvRedis` prefixes the store's on top of that. Building it from
* one of the two names a key nothing ever wrote, and UNLINK then reports 0 without
* failing — a purge that deletes nothing and says so quietly.
*/
async function dropCacheEntries(cache, keys) {
	if (keys.length === 0) return 0;
	const store = redisBackedCacheStore(cache);
	if (store === null) return (await Promise.all(keys.map((key) => {
		return cache.delete(key);
	}))).filter((deleted) => deleted !== false).length;
	const rawKeys = keys.map((key) => {
		return store.createKeyPrefix(`${cache.namespace}:${key}`, store.namespace);
	});
	let dropped = 0;
	for (let at = 0; at < rawKeys.length; at += CACHE_DROP_CHUNK_KEYS) dropped += await store.client.unlink(rawKeys.slice(at, at + CACHE_DROP_CHUNK_KEYS));
	return dropped;
}

//#endregion
export { dropCacheEntries };