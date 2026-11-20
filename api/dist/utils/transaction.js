import { useLogger } from "../logger/index.js";
import { drainQueuedScopedCachePurges, recordQueuedScopedCachePurges } from "../scoped-cache/purged-record.js";
import database_default, { getDatabaseClient } from "../database/index.js";
import { isObject } from "@directus/utils";

//#region src/utils/transaction.ts
/**
* The work each open transaction holds back, keyed by the outermost trx: the one
* `transaction()` opened, or a raw one, given its list when work is first queued
* on it. A savepoint queues on the list of the trx it was opened in.
*/
const afterCommitTasks = /* @__PURE__ */ new WeakMap();
/** The work each open transaction runs if it rolls back, keyed the same way. */
const afterRollbackTasks = /* @__PURE__ */ new WeakMap();
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
* resumes, and they end after. The request's `readRequestPurges` waits for them.
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
	recordQueuedScopedCachePurges(outermostTrx, outermostTrx.executionPromise.then(async () => {
		afterCommitTasks.delete(outermostTrx);
		if (!rollbackRequested) await drainQueuedScopedCachePurges(outermostTrx, () => {
			return drainAfterSettle(database_default(), queuedTasks, "commit");
		});
	}, () => {
		afterCommitTasks.delete(outermostTrx);
	}));
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
* of rows left unchanged. `queueAfterCommitOrRollback` holds a task both ends need.
*/
function queueAfterCommit(knex, task) {
	const queuedTasks = findQueuedTasks(knex) ?? queueOnRawTransaction(knex);
	if (queuedTasks === void 0) return false;
	queuedTasks.push(task);
	return true;
}
/**
* `queueAfterCommit` for a task the transaction needs whichever way it settles:
* run once it commits, or once it rolls back, aborted attempts of a retry
* included. Returns false when nothing will run it, as `queueAfterCommit` does.
*/
function queueAfterCommitOrRollback(knex, task) {
	const rollbackTasks = afterRollbackTasks.get(knex);
	if (rollbackTasks === void 0 || !queueAfterCommit(knex, task)) return false;
	rollbackTasks.push(task);
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
	await drainAfterSettle(knex, queuedTasks, "commit");
	return result;
};
/**
* The `transaction` each tracked database had before `trackTransactionsOf`, which
* `transaction()` opens its own trxs with so they are not held twice.
*/
const untrackedTransactions = /* @__PURE__ */ new WeakMap();
/**
* Make every transaction opened on `database` hold its work for after the commit
* as one `transaction()` opened does, so an extension's own `database.transaction()`
* clears the caches before it resolves rather than after (#633).
*
* It does not retry: a handler re-run without the caller asking could repeat what
* it did outside the trx. A savepoint is the trx's own method, untouched, and
* already waits for the trx it nests in. A trx opened without a handler runs its
* tasks once its `commit()` or `rollback()` resolves, and none if neither is
* called.
*/
function trackTransactionsOf(database) {
	const knexContext = database.context;
	const openUntracked = knexContext.transaction.bind(knexContext);
	untrackedTransactions.set(database, openUntracked);
	knexContext.transaction = (container, config) => {
		if (typeof container === "function") return commitHeldTasks(database, container, config);
		return holdTasksUntilSettled(database, openUntracked(container, config));
	};
}
async function commitHeldTasks(database, handler, config) {
	const { result, queuedTasks } = await commitAttempt(database, handler, config);
	await drainAfterSettle(database, queuedTasks, "commit");
	return result;
}
async function holdTasksUntilSettled(database, openingTrx) {
	const trx = await openingTrx;
	const queuedTasks = [];
	const rollbackTasks = [];
	let drainingTasks = null;
	afterCommitTasks.set(trx, queuedTasks);
	afterRollbackTasks.set(trx, rollbackTasks);
	const drainOnce = (settlement) => {
		if (drainingTasks === null) {
			afterCommitTasks.delete(trx);
			afterRollbackTasks.delete(trx);
			drainingTasks = drainAfterSettle(database, settlement === "commit" ? queuedTasks : rollbackTasks, settlement);
		}
		return drainingTasks;
	};
	const { commit: commitUntracked, rollback: rollbackUntracked } = trx;
	return Object.assign(trx, {
		commit: async (value) => {
			let committedValue;
			try {
				committedValue = await commitUntracked(value);
			} catch (error) {
				await drainOnce("rollback");
				throw error;
			}
			await drainOnce(await trx.executionPromise.then(() => "commit", () => "rollback"));
			return committedValue;
		},
		rollback: async (error) => {
			try {
				return await rollbackUntracked(error);
			} finally {
				await drainOnce("rollback");
			}
		}
	});
}
/**
* One attempt: the handler in a new trx, with the list it queues work on, which
* a failed attempt drops with its trx.
*/
async function commitAttempt(knex, handler, config) {
	const queuedTasks = [];
	const rollbackTasks = [];
	const openedTrxs = [];
	const openTransaction = untrackedTransactions.get(knex) ?? knex.transaction.bind(knex);
	try {
		return {
			result: await openTransaction((trx) => {
				openedTrxs.push(trx);
				afterCommitTasks.set(trx, queuedTasks);
				afterRollbackTasks.set(trx, rollbackTasks);
				return handler(trx);
			}, config),
			queuedTasks
		};
	} catch (error) {
		await drainAfterSettle(knex, rollbackTasks, "rollback");
		throw error;
	} finally {
		for (const openedTrx of openedTrxs) {
			afterCommitTasks.delete(openedTrx);
			afterRollbackTasks.delete(openedTrx);
		}
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
* Run what the settled transaction queued. A committed one drains outside the
* retry loop: a task
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
* purge's own `purgeOrRecord`. After a rollback, it would stand in for the error
* that rolled the write back.
*/
async function drainAfterSettle(knex, queuedTasks, settlement) {
	for (const task of queuedTasks) try {
		await task(knex);
	} catch (error) {
		useLogger().error(error, `[transaction] a task queued after ${settlement} failed: ${error}`);
	}
}
function shouldRetryTransaction(client, error) {
	return isObject(error) && (client === "cockroachdb" && error["code"] === "40001" || client === "sqlite" && error["code"] === "SQLITE_BUSY");
}

//#endregion
export { queueAfterCommit, queueAfterCommitOrRollback, queueMergedAfterCommit, trackTransactionsOf, transaction };