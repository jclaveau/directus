import { useLogger } from "../logger/index.js";
import { clearCache } from "../permissions/cache.js";
import { queueAfterCommitOrRollback } from "./transaction.js";
import { flushResponseCache } from "../scoped-cache/purge.js";
import "../scoped-cache/index.js";
import { clearSystemCache } from "../cache.js";

//#region src/utils/clear-caches-after-commit.ts
/**
* Clear the system cache, and the response cache unless the write opted out,
* once the transaction `knex` belongs to commits. Cleared before, a read landing
* in between caches the permissions the transaction is replacing again.
*
* Cleared once it rolls back too: a read inside the transaction (`withCache`
* on the policies, roles and permissions) may have cached rows the rollback
* removed, which would answer every later request until the TTL.
*/
async function clearCachesAfterCommit(knex, responseCache, opts) {
	if (responseCache && opts?.autoPurgeCache === false) opts.onResponseCacheFlushDeferred?.();
	const clearCaches = async () => {
		await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });
		if (responseCache && opts?.autoPurgeCache !== false) await flushResponseCache(responseCache);
	};
	await runOnceSettled(knex, clearCaches);
}
/**
* Flush the response cache once the transaction `knex` belongs to commits or
* rolls back, as `clearCachesAfterCommit` does; a write that opted out hands
* the flush on to its own batch, if any.
*/
async function flushResponseCacheAfterCommit(knex, responseCache, opts) {
	if (!responseCache) return;
	if (opts?.autoPurgeCache === false) {
		opts.onResponseCacheFlushDeferred?.();
		return;
	}
	await runOnceSettled(knex, () => flushResponseCache(responseCache));
}
/**
* Clear the permissions cache once the transaction `knex` belongs to commits or
* rolls back, as `clearCachesAfterCommit` does.
*/
async function clearPermissionsCacheAfterCommit(knex) {
	await runOnceSettled(knex, () => clearCache());
}
/**
* Run `cacheTask` once the transaction `knex` belongs to commits or rolls back,
* or at once outside a transaction. A savepoint waits for the transaction it
* nests in. A transaction opened on a knex instance `trackTransactionsOf` never
* saw, such as one an extension builds itself, holds no queue, so the task
* follows its `executionPromise` instead, and an error it raises is logged.
*/
async function runOnceSettled(knex, cacheTask) {
	if (!knex.isTransaction) {
		await cacheTask();
		return;
	}
	let outermostTrx = knex;
	while (outermostTrx.parentTransaction) outermostTrx = outermostTrx.parentTransaction;
	if (queueAfterCommitOrRollback(outermostTrx, cacheTask)) return;
	const runLoggingFailure = async () => {
		try {
			await cacheTask();
		} catch (error) {
			useLogger().error(error, `[cache] a flush held until a transaction settled failed: ${error}`);
		}
	};
	outermostTrx.executionPromise.then(runLoggingFailure, runLoggingFailure);
}

//#endregion
export { clearCachesAfterCommit, clearPermissionsCacheAfterCommit, flushResponseCacheAfterCommit };