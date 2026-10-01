import { randomUUID } from 'node:crypto';
import { cacheEntryRawKeyOf } from '../cache-drop.js';
import { holdCacheLock, releaseCacheLock } from '../cache-lock.js';
import { useLogger } from '../logger/index.js';
import { scopedCachePurgeEnabled } from './config.js';
import { scopedCacheFillPaused } from './fill-pause.js';
import { useScopedCacheStore } from './store.js';

// Short-lived and renewed while the pass goes on, as the audit run's is: a
// process that dies mid-pass frees it within the TTL.
const REAP_LOCK = 'scoped-cache-index:reap';
const REAP_LOCK_TTL_MS = 120_000;
const REAP_LOCK_RENEW_MS = 30_000;

const REAP_REQUEST_DEBOUNCE_MS = 1_000;
const REAP_LOCK_POLL_MS = 5_000;

let requestedPass: Promise<void> | null = null;
let passRequestedAgain = false;
let forcedPassRequested = false;
let promptPassRequested = false;
let endDebounceEarly: (() => void) | null = null;

type ScopedCacheIndexReapRequest = {
	/**
	 * Walk the index even while its index-key sets are marked complete. What a
	 * drop asks for: it keeps the names of the sets it unlinked, marker and all,
	 * and only a pass releases them.
	 */
	forcePass?: boolean;
	/**
	 * Start the pass now rather than after the debounce. What a caller awaiting
	 * the pass asks for: an operator's clear answers once its pass is over, and
	 * a read sent after the answer then fills under no pass.
	 */
	skipDebounce?: boolean;
};

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
export function requestScopedCacheIndexReap(
	reapRequest: ScopedCacheIndexReapRequest = {},
): Promise<void> {
	if (!scopedCachePurgeEnabled()) {
		return Promise.resolve();
	}

	if (reapRequest.forcePass === true) {
		forcedPassRequested = true;
	}

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

async function runRequestedReaps(): Promise<void> {
	do {
		if (!promptPassRequested) {
			await waitDebounce();
		}

		// After the wait: what arrived during it is answered by this pass.
		passRequestedAgain = false;
		promptPassRequested = false;
		const passForced = forcedPassRequested;

		forcedPassRequested = false;

		try {
			await reapUntilMarkedComplete(passForced);
		}
		catch (error: any) {
			useLogger().warn(
				error,
				`[scoped-cache] requested index reap failed: ${error}`,
			);
		}
	}
	while (passRequestedAgain);
}

// A pass already holding the lock may have read the index before the drop that
// asked for this one, and then marks nothing: wait for it, and look again. None
// while fills are paused: the pause refuses its mark, and its end asks for the
// one pass that can write it, and releases what the drop left.
async function reapUntilMarkedComplete(passForced: boolean): Promise<void> {
	while (
		!scopedCacheFillPaused()
		&& (passForced || await useScopedCacheStore().indexKeysComplete() === false)
	) {
		if (await runScopedCacheIndexReap()) {
			return;
		}

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
export async function runScopedCacheIndexReap(): Promise<boolean> {
	// Lazily, for the reason `reapScopedCacheIndex` imports `cache.js` lazily:
	// both import back the module that imports this one.
	const { getCache } = await import('../cache.js');
	const { lockCache } = getCache();

	// Only a Redis lock cache is one every node reads, and the index is in
	// Redis only: a reap has nothing to walk without it.
	if (cacheEntryRawKeyOf(lockCache) === null) {
		return false;
	}

	const passToken = randomUUID();

	if (!(await holdCacheLock(lockCache, REAP_LOCK, passToken, REAP_LOCK_TTL_MS))) {
		return false;
	}

	let renewing: Promise<unknown> = Promise.resolve();

	const renewal = setInterval(() => {
		renewing = holdCacheLock(lockCache, REAP_LOCK, passToken, REAP_LOCK_TTL_MS)
			.catch(() => {});
	}, REAP_LOCK_RENEW_MS);

	renewal.unref();

	try {
		const { reapScopedCacheIndex } = await import('./purge.js');

		await reapScopedCacheIndex();
	}
	finally {
		clearInterval(renewal);
		// A renewal still on the wire would land after the release.
		await renewing;

		// Refused, the lock stays until its TTL: only the next pass waits longer.
		await releaseCacheLock(lockCache, REAP_LOCK, passToken).catch(() => {});
	}

	return true;
}

// Ended early by a request skipping the debounce, which then joins this pass.
function waitDebounce(): Promise<void> {
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

function waitUnreferenced(delayMs: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, delayMs).unref();
	});
}
