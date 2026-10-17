import type { MutationOptions } from '@directus/types';
import type { Knex } from 'knex';
import type { Keyv } from 'keyv';
import { clearSystemCache } from '../cache.js';
import { flushResponseCache } from '../scoped-cache/index.js';
import { queueAfterCommit } from './transaction.js';

/**
 * Clear the system cache, and the response cache unless the write opted out,
 * once the transaction `knex` belongs to commits. Cleared before, a read landing
 * in between caches the permissions the transaction is replacing again.
 */
export async function clearCachesAfterCommit(
	knex: Knex,
	responseCache: Keyv | null,
	opts?: MutationOptions,
): Promise<void> {
	const clearCaches = async () => {
		await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });

		if (responseCache && opts?.autoPurgeCache !== false) {
			await flushResponseCache(responseCache);
		}
	};

	if (!queueAfterCommit(knex, clearCaches)) {
		await clearCaches();
	}
}
