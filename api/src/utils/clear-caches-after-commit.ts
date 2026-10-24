import type { MutationOptions } from '@directus/types';
import type { Knex } from 'knex';
import type { Keyv } from 'keyv';
import { clearSystemCache } from '../cache.js';
import { useLogger } from '../logger/index.js';
import { flushResponseCache } from '../scoped-cache/index.js';
import { queueAfterCommitOrRollback } from './transaction.js';

/**
 * Set by a batch that runs its rows with `autoPurgeCache` off: a row asking for
 * a response-cache flush reports it here, and the batch flushes once for all.
 */
export type ResponseCacheFlushDeferral = {
	onResponseCacheFlushDeferred?: () => void;
};

/**
 * Clear the system cache, and the response cache unless the write opted out,
 * once the transaction `knex` belongs to commits. Cleared before, a read landing
 * in between caches the permissions the transaction is replacing again.
 *
 * Cleared once it rolls back too: a read inside the transaction (`withCache`
 * on the policies, roles and permissions) may have cached rows the rollback
 * removed, which would answer every later request until the TTL.
 */
export async function clearCachesAfterCommit(
	knex: Knex,
	responseCache: Keyv | null,
	opts?: MutationOptions & ResponseCacheFlushDeferral,
): Promise<void> {
	if (responseCache && opts?.autoPurgeCache === false) {
		opts.onResponseCacheFlushDeferred?.();
	}

	const clearCaches = async () => {
		await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });

		if (responseCache && opts?.autoPurgeCache !== false) {
			await flushResponseCache(responseCache);
		}
	};

	await runOnceSettled(knex, clearCaches);
}

/**
 * Flush the response cache once the transaction `knex` belongs to commits or
 * rolls back, as `clearCachesAfterCommit` does; a write that opted out hands
 * the flush on to its own batch, if any.
 */
export async function flushResponseCacheAfterCommit(
	knex: Knex,
	responseCache: Keyv | null,
	opts?: MutationOptions & ResponseCacheFlushDeferral,
): Promise<void> {
	if (!responseCache) {
		return;
	}

	if (opts?.autoPurgeCache === false) {
		opts.onResponseCacheFlushDeferred?.();

		return;
	}

	await runOnceSettled(knex, () => flushResponseCache(responseCache));
}

/**
 * Run `cacheTask` once the transaction `knex` belongs to commits or rolls back,
 * or at once outside a transaction. A savepoint waits for the transaction it
 * nests in. A transaction opened on a knex instance `trackTransactionsOf` never
 * saw, such as one an extension builds itself, holds no queue, so the task
 * follows its `executionPromise` instead, and an error it raises is logged.
 */
async function runOnceSettled(
	knex: Knex,
	cacheTask: () => Promise<void>,
): Promise<void> {
	if (!knex.isTransaction) {
		await cacheTask();

		return;
	}

	let outermostTrx = knex as Knex.Transaction;

	while (outermostTrx.parentTransaction) {
		outermostTrx = outermostTrx.parentTransaction;
	}

	if (queueAfterCommitOrRollback(outermostTrx, cacheTask)) {
		return;
	}

	const runLoggingFailure = async () => {
		try {
			await cacheTask();
		}
		catch (error) {
			useLogger().error(
				error,
				`[cache] a flush held until a transaction settled failed: ${error}`,
			);
		}
	};

	void outermostTrx.executionPromise.then(runLoggingFailure, runLoggingFailure);
}
