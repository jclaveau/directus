import { useLogger } from "../logger/index.js";
import { useScopedCacheStore } from "./store.js";
import { scopedCachePurgeEnabled } from "./config.js";
import { cacheEntryRawKeyOf } from "../cache-drop.js";
import { holdCacheLock, releaseCacheLock } from "../cache-lock.js";
import { scopedCacheFillPaused } from "./fill-pause.js";
import { randomUUID } from "node:crypto";

//#region src/scoped-cache/reap-requests.ts
const REAP_LOCK = "scoped-cache-index:reap";
const REAP_LOCK_TTL_MS = 12e4;
const REAP_LOCK_RENEW_MS = 3e4;
const REAP_REQUEST_DEBOUNCE_MS = 1e3;
const REAP_LOCK_POLL_MS = 5e3;
let requestedPass = null;
let passRequestedAgain = false;
let forcedPassRequested = false;
let promptPassRequested = false;
let endDebounceEarly = null;
/**
* Walk the index once more, soon, unless its index-key sets are already marked
* complete — `forcePass` walks it anyway — or fills are paused. What a drop of
* the index and a boot ask for: until a reap walks it, every collection-wide
* purge SCANs the keyspace, and the scheduled reap may be hours away or switched
* off.
*
* Coalesced: a request while one is waiting joins it, forcing it when it forces,
* and one while a pass runs gets one more pass after it, so a burst of flushes
* costs one or two, and `skipDebounce` starts the waiting one at once. Resolves
* once the pass answering it is over, for a caller that awaits it. Never
* rejects: a pass that fails is logged, and costs SCANs until the next, never a
* stale hit.
*/
function requestScopedCacheIndexReap(reapRequest = {}) {
	if (!scopedCachePurgeEnabled()) return Promise.resolve();
	if (reapRequest.forcePass === true) forcedPassRequested = true;
	if (reapRequest.skipDebounce === true) {
		promptPassRequested = true;
		endDebounceEarly?.();
	}
	if (requestedPass !== null) {
		passRequestedAgain = true;
		return requestedPass;
	}
	requestedPass = runRequestedReaps().finally(() => {
		requestedPass = null;
	});
	return requestedPass;
}
async function runRequestedReaps() {
	do {
		if (!promptPassRequested) await waitDebounce();
		passRequestedAgain = false;
		promptPassRequested = false;
		const passForced = forcedPassRequested;
		forcedPassRequested = false;
		try {
			await reapUntilMarkedComplete(passForced);
		} catch (error) {
			useLogger().warn(error, `[scoped-cache] requested index reap failed: ${error}`);
		}
	} while (passRequestedAgain);
}
async function reapUntilMarkedComplete(passForced) {
	while (!scopedCacheFillPaused() && (passForced || await useScopedCacheStore().indexKeysComplete() === false)) {
		if (await runScopedCacheIndexReap()) return;
		await waitUnreferenced(REAP_LOCK_POLL_MS);
	}
}
/**
* One reap of the index, unless another holds the reap's lock — on this node
* or any other. Answers whether it ran.
*
* The lock names the pass holding it, so a pass that lost it to its TTL never
* renews or releases the one another pass claimed since. It keeps its key in
* the lock cache, which a lock flush clears.
*/
async function runScopedCacheIndexReap() {
	const { getCache } = await import("../cache.js");
	const { lockCache } = getCache();
	if (cacheEntryRawKeyOf(lockCache) === null) return false;
	const passToken = randomUUID();
	if (!await holdCacheLock(lockCache, REAP_LOCK, passToken, REAP_LOCK_TTL_MS)) return false;
	let renewing = Promise.resolve();
	const renewal = setInterval(() => {
		renewing = holdCacheLock(lockCache, REAP_LOCK, passToken, REAP_LOCK_TTL_MS).catch(() => {});
	}, REAP_LOCK_RENEW_MS);
	renewal.unref();
	try {
		const { reapScopedCacheIndex } = await import("./purge.js");
		await reapScopedCacheIndex();
	} finally {
		clearInterval(renewal);
		await renewing;
		await releaseCacheLock(lockCache, REAP_LOCK, passToken).catch(() => {});
	}
	return true;
}
function waitDebounce() {
	return new Promise((resolve) => {
		const debounceTimer = setTimeout(endDebounce, REAP_REQUEST_DEBOUNCE_MS);
		debounceTimer.unref();
		function endDebounce() {
			clearTimeout(debounceTimer);
			endDebounceEarly = null;
			resolve();
		}
		endDebounceEarly = endDebounce;
	});
}
function waitUnreferenced(delayMs) {
	return new Promise((resolve) => {
		setTimeout(resolve, delayMs).unref();
	});
}

//#endregion
export { requestScopedCacheIndexReap, runScopedCacheIndexReap };