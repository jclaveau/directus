import { requestStore } from "../utils/request-store.js";
import { AsyncLocalStorage } from "node:async_hooks";

//#region src/scoped-cache/purged-record.ts
function recordScopedCachePurged(purged) {
	const purgedRecord = requestStore.getStore()?.scopedCachePurged;
	if (purgedRecord === void 0 || purgedRecord.purged === null) return;
	if (purged === null) {
		purgedRecord.purged = null;
		return;
	}
	for (const purgedFingerprint of purged) purgedRecord.purged.push(purgedFingerprint);
}
/**
* The transactions whose queued work is running around the caller: a read made
* from inside that work (a `cache.purge` filter calling `readRequestPurges`)
* must not wait for the work it is part of.
*/
const drainingTransactionStore = new AsyncLocalStorage();
function drainQueuedScopedCachePurges(transaction, drainQueuedTasks) {
	return drainingTransactionStore.run([...drainingTransactionStore.getStore() ?? [], transaction], drainQueuedTasks);
}
function recordQueuedScopedCachePurges(transaction, settled) {
	const purgedRecord = requestStore.getStore()?.scopedCachePurged;
	if (purgedRecord === void 0) return;
	const queuedPurge = {
		transaction,
		settled: settled.finally(() => {
			purgedRecord.queuedPurges = purgedRecord.queuedPurges.filter((queued) => {
				return queued !== queuedPurge;
			});
		})
	};
	purgedRecord.queuedPurges.push(queuedPurge);
}
/**
* The request's purged list once the purges it queued on a raw transaction's
* settling have run. A copy: the caller holds what was reached so far.
*/
async function readRequestScopedCachePurges() {
	const purgedRecord = requestStore.getStore()?.scopedCachePurged;
	if (purgedRecord === void 0) throw new Error("readRequestPurges() was called outside a request: no purged list to read");
	const drainingTransactions = drainingTransactionStore.getStore() ?? [];
	const findAwaitableQueues = () => {
		return purgedRecord.queuedPurges.filter((queuedPurge) => {
			return queuedPurge.transaction.isCompleted() && !drainingTransactions.includes(queuedPurge.transaction);
		});
	};
	let awaitableQueues = findAwaitableQueues();
	while (awaitableQueues.length > 0) {
		await Promise.all(awaitableQueues.map((queuedPurge) => queuedPurge.settled));
		awaitableQueues = findAwaitableQueues();
	}
	return purgedRecord.purged === null ? null : [...purgedRecord.purged];
}

//#endregion
export { drainQueuedScopedCachePurges, readRequestScopedCachePurges, recordQueuedScopedCachePurges, recordScopedCachePurged };