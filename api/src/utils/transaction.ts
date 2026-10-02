import { isObject } from '@directus/utils';
import { type Knex } from 'knex';
import { getDatabaseClient } from '../database/index.js';
import { useLogger } from '../logger/index.js';
import type { DatabaseClient } from '@directus/types';

/**
 * Work held back until a transaction commits. It is handed the connection the
 * transaction was opened on, the trx being gone by then.
 */
type AfterCommitTask = (database: Knex) => Promise<void>;

/**
 * The work each open transaction holds back, keyed by the trx `transaction()`
 * opened. A trx it did not open has no entry, so work queued on it runs at once,
 * as before.
 */
const afterCommitTasks = new WeakMap<Knex, AfterCommitTask[]>();

/**
 * Hold `task` until the transaction `knex` belongs to commits, when `transaction()`
 * opened it. Returns false when nothing will run it later: `knex` is no
 * transaction, or one opened elsewhere, and the caller runs the task itself.
 *
 * A rolled-back transaction drops its tasks: nothing it wrote landed, so nothing
 * needs them. A retried one drops the aborted attempt's tasks with that attempt.
 */
export function queueAfterCommit(knex: Knex, task: AfterCommitTask): boolean {
	const queuedTasks = afterCommitTasks.get(knex);

	if (queuedTasks === undefined) {
		return false;
	}

	queuedTasks.push(task);

	return true;
}

/**
 * The requests queued under each merge key, per list of held-back tasks: a retried
 * attempt gets a new list, so it never merges into the aborted attempt's requests.
 * Filed under the merge function too: requests one function merges share its type,
 * so a caller reusing another's key never has its requests handed to the other's.
 */
const mergedRequests = new WeakMap<
	AfterCommitTask[],
	Map<object, Map<string, unknown>>
>();

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
export function queueMergedAfterCommit<Request>(
	knex: Knex,
	mergeKey: string,
	request: Request,
	{
		mergeRequests,
		runRequest,
	}: {
		mergeRequests: (queued: Request, incoming: Request) => Request;
		runRequest: (database: Knex, request: Request) => Promise<void>;
	},
): boolean {
	const queuedTasks = afterCommitTasks.get(knex);

	if (queuedTasks === undefined) {
		return false;
	}

	const requestsByMerger = mergedRequests.get(queuedTasks) ?? new Map();

	mergedRequests.set(queuedTasks, requestsByMerger);

	const queuedRequests: Map<string, Request> =
		requestsByMerger.get(mergeRequests) ?? new Map();

	requestsByMerger.set(mergeRequests, queuedRequests);

	const queuedRequest = queuedRequests.get(mergeKey);

	if (queuedRequest !== undefined) {
		queuedRequests.set(mergeKey, mergeRequests(queuedRequest, request));

		return true;
	}

	queuedRequests.set(mergeKey, request);

	return queueAfterCommit(knex, (database) => {
		return runRequest(database, queuedRequests.get(mergeKey)!);
	});
}

/**
 * Execute the given handler within the current transaction or a newly created one
 * if the current knex state isn't a transaction yet.
 *
 * Can be used to ensure the handler is run within a transaction,
 * while preventing nested transactions.
 */
export const transaction = async <T = unknown>(
	knex: Knex,
	handler: (knex: Knex) => Promise<T>,
	onRetry?: () => void,
): Promise<T> => {
	if (knex.isTransaction) {
		// Reusing the caller's trx means this returns BEFORE any commit, so anything a
		// nested caller runs "after the transaction" actually runs inside it. Work
		// that must follow the commit goes through `queueAfterCommit`.
		return handler(knex);
	}

	const { result, queuedTasks } = await commitWithRetries(knex, handler, onRetry);

	await drainAfterCommit(knex, queuedTasks);

	return result;
};

type CommittedAttempt<T> = { result: T; queuedTasks: AfterCommitTask[] };

/**
 * One attempt: the handler in a new trx, with the list it queues work on, which
 * a failed attempt drops with its trx.
 */
async function commitAttempt<T>(
	knex: Knex,
	handler: (knex: Knex) => Promise<T>,
): Promise<CommittedAttempt<T>> {
	const queuedTasks: AfterCommitTask[] = [];
	const openedTrxs: Knex[] = [];

	try {
		const result = await knex.transaction((trx) => {
			openedTrxs.push(trx);
			afterCommitTasks.set(trx, queuedTasks);

			return handler(trx);
		});

		return { result, queuedTasks };
	}
	finally {
		// Once settled, a straggler queueing on the trx gets false and runs its task
		// itself: pushed onto a list already drained, it would never run.
		for (const openedTrx of openedTrxs) {
			afterCommitTasks.delete(openedTrx);
		}
	}
}

async function commitWithRetries<T>(
	knex: Knex,
	handler: (knex: Knex) => Promise<T>,
	onRetry?: () => void,
): Promise<CommittedAttempt<T>> {
	try {
		return await commitAttempt(knex, handler);
	}
	catch (error) {
		const client = getDatabaseClient(knex);

		// Only sqlite / cockroach reach the retry loop: both hand an aborted
		// transaction back and require the CLIENT to re-run it (no server-side
		// recovery). cockroach's optimistic SERIALIZABLE aborts a txn that lost
		// a write race at commit (40001); sqlite's single writer rejects a
		// concurrent write with SQLITE_BUSY. postgres blocks on locks instead
		// of returning a retry code, so it never lands here.
		if (!shouldRetryTransaction(client, error)) {
			throw error;
		}

		const MAX_ATTEMPTS = 3;
		const BASE_DELAY = 100;

		const logger = useLogger();

		for (let attempt = 0; attempt < MAX_ATTEMPTS; ++attempt) {
			const delay = 2 ** attempt * BASE_DELAY;

			await new Promise((resolve) => setTimeout(resolve, delay));

			const attemptLabel = `attempt ${attempt + 1}/${MAX_ATTEMPTS}`;

			logger.trace(`Restarting failed transaction (${attemptLabel})`);

			// Roll back caller state (e.g. the mutation counter) so a re-run of the
			// handler doesn't accumulate its side effects onto the previous attempt.
			onRetry?.();

			try {
				return await commitAttempt(knex, handler);
			}
			catch (error) {
				if (!shouldRetryTransaction(client, error)) {
					throw error;
				}
			}
		}

		/** Initial execution + additional attempts */
		const attempts = 1 + MAX_ATTEMPTS;
		throw new Error(
			`Transaction failed after ${attempts} attempts`,
			{ cause: error },
		);
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
async function drainAfterCommit(
	knex: Knex,
	queuedTasks: AfterCommitTask[],
): Promise<void> {
	// One after another, as they ran inside the trx: purges of different collections
	// can share index sets, and each shrinks what the next one scans. A hook's
	// purges per row on one collection reach here merged (#594). Every task runs
	// even when one fails: each covers its own write.
	for (const task of queuedTasks) {
		try {
			await task(knex);
		}
		catch (error) {
			useLogger().error(
				error,
				`[transaction] a task queued after commit failed: ${error}`,
			);
		}
	}
}

function shouldRetryTransaction(client: DatabaseClient, error: unknown): boolean {
	/**
	 * This error code indicates that the transaction failed due to another
	 * concurrent or recent transaction attempting to write to the same data.
	 * This can usually be solved by restarting the transaction on client-side
	 * after a short delay, so that it is executed against the latest state.
	 *
	 * @link https://www.cockroachlabs.com/docs/stable/transaction-retry-error-reference
	 */
	const COCKROACH_RETRY_ERROR_CODE = '40001';

	/**
	 * SQLITE_BUSY is an error code returned by SQLite when an operation can't be
	 * performed due to a locked database file. This often arises due to multiple
	 * processes trying to simultaneously access the database, causing potential
	 * data inconsistencies. There are a few mechanisms to handle this case,
	 * one of which is to retry the complete transaction again
	 * on client-side after a short delay.
	 *
	 * @link https://www.sqlite.org/rescode.html#busy
	 */
	const SQLITE_BUSY_ERROR_CODE = 'SQLITE_BUSY';

	return (
		isObject(error) &&
		((client === 'cockroachdb' && error['code'] === COCKROACH_RETRY_ERROR_CODE) ||
			(client === 'sqlite' && error['code'] === SQLITE_BUSY_ERROR_CODE))
	);
}
