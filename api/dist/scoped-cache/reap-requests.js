import { useLogger } from "../logger/index.js";
import { useScopedCacheStore } from "./store.js";
import { scopedCachePurgeEnabled } from "./config.js";
import { scopedCacheFillPaused } from "./fill-pause.js";

//#region src/scoped-cache/reap-requests.ts
const REAP_LOCK = "scoped-cache-index:reap";
const REAP_LOCK_TTL_MS = 12e4;
const REAP_LOCK_RENEW_MS = 3e4;
const REAP_REQUEST_DEBOUNCE_MS = 1e3;
const REAP_LOCK_POLL_MS = 5e3;
let requestedPass = null;
let passRequestedAgain = false;
let forcedPassRequested = false;
/**
* Walk the index once more, soon, unless its index-key sets are already marked
* complete — `forcePass` walks it anyway — or fills are paused. What a drop of
* the index and a boot ask for: until a reap walks it, every collection-wide
* purge SCANs the keyspace, and the scheduled reap may be hours away or switched
* off.
*
* Coalesced: a request while one is waiting joins it, forcing it when it forces,
* and one while a pass runs gets one more pass after it, so a burst of flushes
* costs one or two. Never rejects and never blocks the caller's own work: a pass
* that fails is logged, and costs SCANs until the next, never a stale hit.
*/
function requestScopedCacheIndexReap(reapRequest = {}) {
	if (!scopedCachePurgeEnabled()) return Promise.resolve();
	if (reapRequest.forcePass === true) forcedPassRequested = true;
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
		await waitUnreferenced(REAP_REQUEST_DEBOUNCE_MS);
		passRequestedAgain = false;
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
*/
async function runScopedCacheIndexReap() {
	const { getCache } = await import("../cache.js");
	const { lockCache } = getCache();
	if (await lockCache.get(REAP_LOCK)) return false;
	await lockCache.set(REAP_LOCK, true, REAP_LOCK_TTL_MS);
	let renewing = Promise.resolve();
	const renewal = setInterval(() => {
		renewing = lockCache.set(REAP_LOCK, true, REAP_LOCK_TTL_MS).catch(() => {});
	}, REAP_LOCK_RENEW_MS);
	renewal.unref();
	try {
		const { reapScopedCacheIndex } = await import("./purge.js");
		await reapScopedCacheIndex();
	} finally {
		clearInterval(renewal);
		await renewing;
		await lockCache.delete(REAP_LOCK);
	}
	return true;
}
function waitUnreferenced(delayMs) {
	return new Promise((resolve) => {
		setTimeout(resolve, delayMs).unref();
	});
}

//#endregion
export { requestScopedCacheIndexReap, runScopedCacheIndexReap };