import { AsyncLocalStorage } from 'node:async_hooks';
import type { ScopedCacheFingerprint } from '@directus/types';
import type { Knex } from 'knex';

/**
 * What the scoped-cache purges of one request reached, read by the
 * CACHE_PURGED_TAGS_HEADER and by an extension's `scopedCache.readRequestPurges`:
 * every purgeScopedCache call it awaited, a nested write's queued until its
 * commit (#363) included. `null` once one of them flushed the whole namespace. A
 * purge ending after `respond` (an unawaited action hook) is not named.
 */
export type ScopedCachePurgedRecord = {
	purged: ScopedCacheFingerprint[] | null;
	/**
	 * The work held back until a transaction the request opened raw
	 * (`database.transaction()`) settles, its purges among it: the opener's await
	 * does not wait for it, so `readRequestPurges` does.
	 */
	queuedPurges: { transaction: Knex.Transaction; settled: Promise<void> }[];
};

export const scopedCachePurgedStore =
	new AsyncLocalStorage<ScopedCachePurgedRecord>();

export function recordScopedCachePurged(
	purged: ScopedCacheFingerprint[] | null,
): void {
	const purgedRecord = scopedCachePurgedStore.getStore();

	if (purgedRecord === undefined || purgedRecord.purged === null) {
		return;
	}

	if (purged === null) {
		purgedRecord.purged = null;
		return;
	}

	// Appended in place, one by one: every request records, so a request purging
	// many times must not copy its list on each, and a spread call would throw
	// past some 100k fingerprints (#397).
	for (const purgedFingerprint of purged) {
		purgedRecord.purged.push(purgedFingerprint);
	}
}

export function recordQueuedScopedCachePurges(
	transaction: Knex.Transaction,
	settled: Promise<void>,
): void {
	scopedCachePurgedStore.getStore()?.queuedPurges.push({ transaction, settled });
}

/**
 * The request's purged list once the purges it queued on a raw transaction's
 * settling have run. A copy: the caller holds what was reached so far.
 */
export async function readRequestScopedCachePurges(): Promise<
	ScopedCacheFingerprint[] | null
> {
	const purgedRecord = scopedCachePurgedStore.getStore();

	if (purgedRecord === undefined) {
		throw new Error(
			'readRequestPurges() was called outside a request: '
				+ 'no purged list to read',
		);
	}

	// Only a settled transaction's: awaiting one still open, from inside its own
	// callback, would wait for the very transaction that is waiting on this read.
	// Its writes have not landed, so nothing of theirs is purged yet. Taken in
	// rounds: a queued purge can run a hook that opens a transaction of its own.
	let settledQueues = purgedRecord.queuedPurges.filter((queuedPurge) => {
		return queuedPurge.transaction.isCompleted();
	});

	while (settledQueues.length > 0) {
		purgedRecord.queuedPurges = purgedRecord.queuedPurges.filter((queuedPurge) => {
			return !settledQueues.includes(queuedPurge);
		});

		await Promise.all(settledQueues.map((queuedPurge) => queuedPurge.settled));

		settledQueues = purgedRecord.queuedPurges.filter((queuedPurge) => {
			return queuedPurge.transaction.isCompleted();
		});
	}

	return purgedRecord.purged === null
		? null
		: [...purgedRecord.purged];
}
