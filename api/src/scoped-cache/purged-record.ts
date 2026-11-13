import { AsyncLocalStorage } from 'node:async_hooks';
import type { ScopedCacheFingerprint } from '@directus/types';
import type { Knex } from 'knex';
import { requestStore } from '../utils/request-store.js';

/**
 * What the scoped-cache purges of one request reached, read by the
 * CACHE_PURGED_TAGS_HEADER and by an extension's `scopedCache.readRequestPurges`:
 * every purgeScopedCache call it awaited, a nested write's queued until its
 * commit (#363) included, in call order: two calls reaching one slice name it
 * twice. `null` once one of them flushed the whole namespace. A purge ending
 * after `respond` (an unawaited action hook) is not named.
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

export function recordScopedCachePurged(
	purged: ScopedCacheFingerprint[] | null,
): void {
	const purgedRecord = requestStore.getStore()?.scopedCachePurged;

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

/**
 * The transactions whose queued work is running around the caller: a read made
 * from inside that work (a `cache.purge` filter calling `readRequestPurges`)
 * must not wait for the work it is part of.
 */
const drainingTransactionStore = new AsyncLocalStorage<Knex.Transaction[]>();

export function drainQueuedScopedCachePurges(
	transaction: Knex.Transaction,
	drainQueuedTasks: () => Promise<void>,
): Promise<void> {
	return drainingTransactionStore.run(
		[...(drainingTransactionStore.getStore() ?? []), transaction],
		drainQueuedTasks,
	);
}

export function recordQueuedScopedCachePurges(
	transaction: Knex.Transaction,
	settled: Promise<void>,
): void {
	const purgedRecord = requestStore.getStore()?.scopedCachePurged;

	if (purgedRecord === undefined) {
		return;
	}

	// Let go once settled: nothing reads the list in most requests, and an entry
	// holds the rows of every purge its transaction queued.
	const queuedPurge = {
		transaction,
		settled: settled.finally(() => {
			purgedRecord.queuedPurges = purgedRecord.queuedPurges.filter((queued) => {
				return queued !== queuedPurge;
			});
		}),
	};

	purgedRecord.queuedPurges.push(queuedPurge);
}

/**
 * The request's purged list once the purges it queued on a raw transaction's
 * settling have run. A copy: the caller holds what was reached so far.
 */
export async function readRequestScopedCachePurges(): Promise<
	ScopedCacheFingerprint[] | null
> {
	const purgedRecord = requestStore.getStore()?.scopedCachePurged;

	if (purgedRecord === undefined) {
		throw new Error(
			'readRequestPurges() was called outside a request: '
				+ 'no purged list to read',
		);
	}

	// Only a settled transaction's: awaiting one still open, from inside its own
	// callback, would wait for the very transaction that is waiting on this read.
	// Its writes have not landed, so nothing of theirs is purged yet. Nor the one
	// whose queued work made this read: it would wait for itself. Taken in rounds:
	// a queued purge can run a hook that opens a transaction of its own. Left in
	// the list until settled, so a second read waits for them too.
	const drainingTransactions = drainingTransactionStore.getStore() ?? [];

	const findAwaitableQueues = () => {
		return purgedRecord.queuedPurges.filter((queuedPurge) => {
			return queuedPurge.transaction.isCompleted()
				&& !drainingTransactions.includes(queuedPurge.transaction);
		});
	};

	let awaitableQueues = findAwaitableQueues();

	while (awaitableQueues.length > 0) {
		await Promise.all(awaitableQueues.map((queuedPurge) => queuedPurge.settled));

		awaitableQueues = findAwaitableQueues();
	}

	return purgedRecord.purged === null
		? null
		: [...purgedRecord.purged];
}
