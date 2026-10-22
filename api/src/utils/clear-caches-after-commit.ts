import type { MutationOptions } from '@directus/types';
import type { Knex } from 'knex';
import type { Keyv } from 'keyv';
import { clearSystemCache } from '../cache.js';
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

	if (!queueAfterCommitOrRollback(knex, clearCaches)) {
		await clearCaches();
	}
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

	const flushCache = () => {
		return flushResponseCache(responseCache);
	};

	if (!queueAfterCommitOrRollback(knex, flushCache)) {
		await flushCache();
	}
}
