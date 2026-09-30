import { useRedis } from "./redis/lib/use-redis.js";
import "./redis/index.js";
import { cacheEntryRawKeyOf } from "./cache-drop.js";

//#region src/cache-lock.ts
/**
* Claim the lock for ARGV[2] ms as the token ARGV[1], or renew it while it
* still names that token. One script, so two claims never both win, and a
* holder whose lock expired never renews the one another holder claimed since.
*
* KEYS is the lock. Answers 1 when the token holds it.
*/
const cacheLockHoldScript = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
	return 1
end

if redis.call('GET', KEYS[1]) ~= ARGV[1] then
	return 0
end

redis.call('PEXPIRE', KEYS[1], ARGV[2])

return 1
`;
/**
* Release the lock, only while it names the token ARGV[1]: one that expired
* under a slow holder may be another holder's by now.
*
* KEYS is the lock. Answers 1 when it released it.
*/
const cacheLockReleaseScript = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
	return 0
end

return redis.call('DEL', KEYS[1])
`;
const clientsCarryingLockScripts = /* @__PURE__ */ new WeakSet();
/**
* The shared database's client, which the lock cache's Redis store also writes
* to, carrying the lock scripts: registered once per client, since
* `defineCommand` rebuilds the command each time.
*/
function useLockScriptedRedis() {
	const sharedRedis = useRedis();
	if (!clientsCarryingLockScripts.has(sharedRedis)) {
		sharedRedis.defineCommand("cacheLockHold", {
			numberOfKeys: 1,
			lua: cacheLockHoldScript
		});
		sharedRedis.defineCommand("cacheLockRelease", {
			numberOfKeys: 1,
			lua: cacheLockReleaseScript
		});
		clientsCarryingLockScripts.add(sharedRedis);
	}
	return sharedRedis;
}
/**
* Claims the lock for the owner's token, or renews it while that token still
* holds it. Answers whether the token holds it.
*
* On Redis the token is the key's raw value, written and compared in one
* script, so a holder whose lock expired never takes back or renews the one
* another holder claimed since. A memory lock cache is one process's, and its
* read then write has no other process to race.
*/
async function holdCacheLock(lockCache, lockKey, ownerToken, lockTtlMs) {
	const rawKeyOf = cacheEntryRawKeyOf(lockCache);
	if (rawKeyOf === null) {
		const holderToken = await lockCache.get(lockKey);
		if (holderToken !== void 0 && holderToken !== ownerToken) return false;
		await lockCache.set(lockKey, ownerToken, lockTtlMs);
		return true;
	}
	return await useLockScriptedRedis().cacheLockHold(rawKeyOf(lockKey), ownerToken, lockTtlMs) === 1;
}
/** Releases the lock only while the owner's token still holds it. */
async function releaseCacheLock(lockCache, lockKey, ownerToken) {
	const rawKeyOf = cacheEntryRawKeyOf(lockCache);
	if (rawKeyOf === null) {
		if (await lockCache.get(lockKey) === ownerToken) await lockCache.delete(lockKey);
		return;
	}
	await useLockScriptedRedis().cacheLockRelease(rawKeyOf(lockKey), ownerToken);
}
/**
* The token holding the lock, or null while no one holds it. Read raw on Redis:
* the token is no Keyv value there.
*/
async function readCacheLockHolder(lockCache, lockKey) {
	const rawKeyOf = cacheEntryRawKeyOf(lockCache);
	if (rawKeyOf === null) return await lockCache.get(lockKey) ?? null;
	return useRedis().get(rawKeyOf(lockKey));
}

//#endregion
export { cacheLockHoldScript, cacheLockReleaseScript, holdCacheLock, readCacheLockHolder, releaseCacheLock };