import { useLogger } from "../logger/index.js";
import database_default, { getDatabaseClient } from "../database/index.js";
import { isObject } from "@directus/utils";

//#region src/utils/transaction.ts
/**
* The work each open transaction holds back, keyed by the outermost trx: the one
* `transaction()` opened, or a raw one, given its list when work is first queued
* on it. A savepoint queues on the list of the trx it was opened in.
*/
const afterCommitTasks = /* @__PURE__ */ new WeakMap();
/**
* The tasks held back for the transaction `knex` belongs to: its own, or, for a
* savepoint `trx.transaction()` opened, the ones of the transaction it was opened
* in, which its writes commit with.
*/
function findQueuedTasks(knex) {
	let openTrx = knex;
	while (openTrx !== void 0) {
		const queuedTasks = afterCommitTasks.get(openTrx);
		if (queuedTasks !== void 0) return queuedTasks;
		openTrx = openTrx.parentTransaction;
	}
}
/**
* The list for a trx `transaction()` did not open: a raw `database.transaction()`
* an extension or a service opened itself, handing its trx to a service whose
* purge would otherwise run before that trx commits (#641). Undefined when
* `knex` is no open trx.
*
* Its tasks run once it settled without a rollback, on the database
* `getDatabase()` returns, the trx carrying no link to the knex it was opened on.
* The opener's await does not wait for them: the first one starts before it
* resumes, and they end after.
*/
function queueOnRawTransaction(knex) {
	let outermostTrx = knex;
	if (!outermostTrx.isTransaction) return;
	while (outermostTrx.parentTransaction !== void 0) outermostTrx = outermostTrx.parentTransaction;
	if (outermostTrx.isCompleted()) return;
	const queuedTasks = [];
	const { rollback } = outermostTrx;
	let rollbackRequested = false;
	outermostTrx.rollback = (error) => {
		rollbackRequested = true;
		return rollback.call(outermostTrx, error);
	};
	afterCommitTasks.set(outermostTrx, queuedTasks);
	outermostTrx.executionPromise.then(async () => {
		afterCommitTasks.delete(outermostTrx);
		if (!rollbackRequested) await drainAfterCommit(database_default(), queuedTasks);
	}, () => {
		afterCommitTasks.delete(outermostTrx);
	});
	return queuedTasks;
}
/**
* Hold `task` until the transaction `knex` belongs to commits. Returns false when
* nothing will run it later: `knex` is no transaction, or one already settled,
* and the caller runs the task itself.
*
* A rolled-back transaction drops its tasks: nothing it wrote landed, so nothing
* needs them. A retried one drops the aborted attempt's tasks with that attempt.
* A rolled-back savepoint keeps them: they run once the outer one commits, a purge
* of rows left unchanged.
*/
function queueAfterCommit(knex, task) {
	const queuedTasks = findQueuedTasks(knex) ?? queueOnRawTransaction(knex);
	if (queuedTasks === void 0) return false;
	queuedTasks.push(task);
	return true;
}
/**
* The requests queued under each merge key, per list of held-back tasks: a retried
* attempt gets a new list, so it never merges into the aborted attempt's requests.
* Filed under the merge function too: requests one function merges share its type,
* so a caller reusing another's key never has its requests handed to the other's.
*/
const mergedRequests = /* @__PURE__ */ new WeakMap();
/**
* `queueAfterCommit` for work that merges: a request queued under a key this
* transaction already holds is merged into it, and the merge runs as one task in
* the place of the first. Returns false, as `queueAfterCommit` does, when nothing
* will run it.
*
* `mergeRequests` names the kind of request as much as the key does: requests
* merge only when handed the same function, so it is defined once, not inline.
*
* A hook writing per row on its parent's trx queues one purge per row, each
* scanning the same index sets: merged, they scan once (#594).
*/
function queueMergedAfterCommit(knex, mergeKey, request, { mergeRequests, runRequest }) {
	const queuedTasks = findQueuedTasks(knex) ?? queueOnRawTransaction(knex);
	if (queuedTasks === void 0) return false;
	const requestsByMerger = mergedRequests.get(queuedTasks) ?? /* @__PURE__ */ new Map();
	mergedRequests.set(queuedTasks, requestsByMerger);
	const queuedRequests = requestsByMerger.get(mergeRequests) ?? /* @__PURE__ */ new Map();
	requestsByMerger.set(mergeRequests, queuedRequests);
	const queuedRequest = queuedRequests.get(mergeKey);
	if (queuedRequest !== void 0) {
		queuedRequests.set(mergeKey, mergeRequests(queuedRequest, request));
		return true;
	}
	queuedRequests.set(mergeKey, request);
	return queueAfterCommit(knex, (database) => {
		return runRequest(database, queuedRequests.get(mergeKey));
	});
}
/**
* Execute the given handler within the current transaction or a newly created one
* if the current knex state isn't a transaction yet.
*
* Can be used to ensure the handler is run within a transaction,
* while preventing nested transactions.
*/
const transaction = async (knex, handler, onRetry) => {
	if (knex.isTransaction) return handler(knex);
	const { result, queuedTasks } = await commitWithRetries(knex, handler, onRetry);
	await drainAfterCommit(knex, queuedTasks);
	return result;
};
/**
* One attempt: the handler in a new trx, with the list it queues work on, which
* a failed attempt drops with its trx.
*/
async function commitAttempt(knex, handler) {
	const queuedTasks = [];
	const openedTrxs = [];
	try {
		return {
			result: await knex.transaction((trx) => {
				openedTrxs.push(trx);
				afterCommitTasks.set(trx, queuedTasks);
				return handler(trx);
			}),
			queuedTasks
		};
	} finally {
		for (const openedTrx of openedTrxs) afterCommitTasks.delete(openedTrx);
	}
}
async function commitWithRetries(knex, handler, onRetry) {
	try {
		return await commitAttempt(knex, handler);
	} catch (error) {
		const client = getDatabaseClient(knex);
		if (!shouldRetryTransaction(client, error)) throw error;
		const MAX_ATTEMPTS = 3;
		const BASE_DELAY = 100;
		const logger = useLogger();
		for (let attempt = 0; attempt < MAX_ATTEMPTS; ++attempt) {
			const delay = 2 ** attempt * BASE_DELAY;
			await new Promise((resolve) => setTimeout(resolve, delay));
			const attemptLabel = `attempt ${attempt + 1}/${MAX_ATTEMPTS}`;
			logger.trace(`Restarting failed transaction (${attemptLabel})`);
			onRetry?.();
			try {
				return await commitAttempt(knex, handler);
			} catch (error$1) {
				if (!shouldRetryTransaction(client, error$1)) throw error$1;
			}
		}
		/** Initial execution + additional attempts */
		const attempts = 1 + MAX_ATTEMPTS;
		throw new Error(`Transaction failed after ${attempts} attempts`, { cause: error });
	}
}
/**
* Run what the committed transaction queued. Outside the retry loop: a task
* failing with a retryable code must not re-run a write that already landed.
* Awaited, not left floating: a task lost on process death leaves what it was for
* undone with nothing coming to redo it.
*
* A purge drained here opens a window of its own: between COMMIT and its DEL a
* reader can still HIT the old entry. That window is one round trip and it closes;
* the one it replaces let a reader re-index pre-commit rows under the tag just
* dropped, stale until TTL, and held the connection `idle in transaction` for as
* long as Redis took to answer (#363).
*
* A failure is logged, not thrown: the write is durable by now, and a 500 for it
* invites a client retry that duplicates a non-idempotent write. Same rule as the
* purge's own `purgeOrRecord`.
*/
async function drainAfterCommit(knex, queuedTasks) {
	for (const task of queuedTasks) try {
		await task(knex);
	} catch (error) {
		useLogger().error(error, `[transaction] a task queued after commit failed: ${error}`);
	}
}
function shouldRetryTransaction(client, error) {
	return isObject(error) && (client === "cockroachdb" && error["code"] === "40001" || client === "sqlite" && error["code"] === "SQLITE_BUSY");
}

//#endregion
export { queueAfterCommit, queueMergedAfterCommit, transaction };