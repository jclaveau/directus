import { isObject } from '@directus/utils';
import { type Knex } from 'knex';
import getDatabase, { getDatabaseClient } from '../database/index.js';
import { useLogger } from '../logger/index.js';
import type { DatabaseClient } from '@directus/types';

/**
 * Work held back until a transaction commits. It is handed the connection the
 * transaction was opened on, the trx being gone by then.
 */
type AfterCommitTask = (database: Knex) => Promise<void>;

/**
 * The work each open transaction holds back, keyed by the outermost trx: the one
 * `transaction()` opened, or a raw one, given its list when work is first queued
 * on it. A savepoint queues on the list of the trx it was opened in.
 */
const afterCommitTasks = new WeakMap<Knex, AfterCommitTask[]>();

/** The work each open transaction runs if it rolls back, keyed the same way. */
const afterRollbackTasks = new WeakMap<Knex, AfterCommitTask[]>();

/**
 * The tasks held back for the transaction `knex` belongs to: its own, or, for a
 * savepoint `trx.transaction()` opened, the ones of the transaction it was opened
 * in, which its writes commit with.
 */
function findQueuedTasks(knex: Knex): AfterCommitTask[] | undefined {
	let openTrx: Knex.Transaction | undefined = knex as Knex.Transaction;

	while (openTrx !== undefined) {
		const queuedTasks = afterCommitTasks.get(openTrx);

		if (queuedTasks !== undefined) {
			return queuedTasks;
		}

		openTrx = openTrx.parentTransaction;
	}

	return undefined;
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
function queueOnRawTransaction(knex: Knex): AfterCommitTask[] | undefined {
	let outermostTrx = knex as Knex.Transaction;

	if (!outermostTrx.isTransaction) {
		return undefined;
	}

	while (outermostTrx.parentTransaction !== undefined) {
		outermostTrx = outermostTrx.parentTransaction;
	}

	// Checked on the outermost trx: a savepoint released inside it still commits
	// with it.
	if (outermostTrx.isCompleted()) {
		return undefined;
	}

	const queuedTasks: AfterCommitTask[] = [];
	const { rollback } = outermostTrx;
	let rollbackRequested = false;

	// A trx opened without a handler and rolled back resolves as a committed one
	// does: only a call to its rollback tells them apart. Watched rather than its
	// commit: an opener that took the method before this ran goes unseen, and a
	// rollback unseen costs a purge of rows left unchanged, a commit unseen a
	// stale row.
	outermostTrx.rollback = (error) => {
		rollbackRequested = true;

		return rollback.call(outermostTrx, error);
	};

	afterCommitTasks.set(outermostTrx, queuedTasks);

	outermostTrx.executionPromise.then(
		async () => {
			afterCommitTasks.delete(outermostTrx);

			if (!rollbackRequested) {
				await drainAfterSettle(getDatabase(), queuedTasks, 'commit');
			}
		},
		() => {
			afterCommitTasks.delete(outermostTrx);
		},
	);

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
export function queueAfterCommit(knex: Knex, task: AfterCommitTask): boolean {
	const queuedTasks = findQueuedTasks(knex) ?? queueOnRawTransaction(knex);

	if (queuedTasks === undefined) {
		return false;
	}

	queuedTasks.push(task);

	return true;
}

/**
 * `queueAfterCommit` for a task the transaction needs whichever way it settles:
 * run once it commits, or once it rolls back, aborted attempts of a retry
 * included. Returns false when nothing will run it, as `queueAfterCommit` does.
 */
export function queueAfterCommitOrRollback(
	knex: Knex,
	task: AfterCommitTask,
): boolean {
	const rollbackTasks = afterRollbackTasks.get(knex);

	if (rollbackTasks === undefined || !queueAfterCommit(knex, task)) {
		return false;
	}

	rollbackTasks.push(task);

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
	const queuedTasks = findQueuedTasks(knex) ?? queueOnRawTransaction(knex);

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

	await drainAfterSettle(knex, queuedTasks, 'commit');

	return result;
};

type CommittedAttempt<T> = { result: T; queuedTasks: AfterCommitTask[] };

type OpenTransaction = (
	container?: unknown,
	config?: Knex.TransactionConfig,
) => Promise<any>;

/**
 * Where knex keeps the methods a knex instance forwards to, `transaction` among
 * them. `transactionProvider()` calls it there, not on the instance.
 */
type KnexContext = { transaction: OpenTransaction };

/**
 * The `transaction` each tracked database had before `trackTransactionsOf`, which
 * `transaction()` opens its own trxs with so they are not held twice.
 */
const untrackedTransactions = new WeakMap<Knex, OpenTransaction>();

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
export function trackTransactionsOf(database: Knex): void {
	const knexContext = (database as Knex & { context: KnexContext }).context;
	const openUntracked = knexContext.transaction.bind(knexContext);

	untrackedTransactions.set(database, openUntracked);

	knexContext.transaction = (container, config) => {
		if (typeof container === 'function') {
			return commitHeldTasks(database, container as never, config);
		}

		return holdTasksUntilSettled(database, openUntracked(container, config));
	};
}

async function commitHeldTasks<T>(
	database: Knex,
	handler: (trx: Knex) => Promise<T>,
	config?: Knex.TransactionConfig,
): Promise<T> {
	const { result, queuedTasks } = await commitAttempt(database, handler, config);

	await drainAfterSettle(database, queuedTasks, 'commit');

	return result;
}

async function holdTasksUntilSettled(
	database: Knex,
	openingTrx: Promise<Knex.Transaction>,
): Promise<Knex.Transaction> {
	const trx = await openingTrx;
	const queuedTasks: AfterCommitTask[] = [];
	const rollbackTasks: AfterCommitTask[] = [];
	let drainingTasks: Promise<void> | null = null;

	afterCommitTasks.set(trx, queuedTasks);
	afterRollbackTasks.set(trx, rollbackTasks);

	const drainOnce = (settlement: 'commit' | 'rollback') => {
		if (drainingTasks === null) {
			afterCommitTasks.delete(trx);
			afterRollbackTasks.delete(trx);

			const settledTasks = settlement === 'commit'
				? queuedTasks
				: rollbackTasks;

			drainingTasks = drainAfterSettle(database, settledTasks, settlement);
		}

		return drainingTasks;
	};

	const { commit: commitUntracked, rollback: rollbackUntracked } = trx;

	return Object.assign(trx, {
		commit: async (value?: unknown) => {
			let committedValue: unknown;

			try {
				committedValue = await commitUntracked(value);
			}
			catch (error) {
				await drainOnce('rollback');

				throw error;
			}

			await drainOnce('commit');

			return committedValue;
		},
		rollback: async (error?: unknown) => {
			try {
				return await rollbackUntracked(error);
			}
			finally {
				await drainOnce('rollback');
			}
		},
	});
}

/**
 * One attempt: the handler in a new trx, with the list it queues work on, which
 * a failed attempt drops with its trx.
 */
async function commitAttempt<T>(
	knex: Knex,
	handler: (knex: Knex) => Promise<T>,
	config?: Knex.TransactionConfig,
): Promise<CommittedAttempt<T>> {
	const queuedTasks: AfterCommitTask[] = [];
	const rollbackTasks: AfterCommitTask[] = [];
	const openedTrxs: Knex[] = [];

	const openTransaction = untrackedTransactions.get(knex)
		?? (knex.transaction.bind(knex) as OpenTransaction);

	try {
		const result = await openTransaction((trx: Knex.Transaction) => {
			openedTrxs.push(trx);
			afterCommitTasks.set(trx, queuedTasks);
			afterRollbackTasks.set(trx, rollbackTasks);

			return handler(trx);
		}, config);

		return { result, queuedTasks };
	}
	catch (error) {
		await drainAfterSettle(knex, rollbackTasks, 'rollback');

		throw error;
	}
	finally {
		// Once settled, a straggler queueing on the trx gets false and runs its task
		// itself: pushed onto a list already drained, it would never run.
		for (const openedTrx of openedTrxs) {
			afterCommitTasks.delete(openedTrx);
			afterRollbackTasks.delete(openedTrx);
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
async function drainAfterSettle(
	knex: Knex,
	queuedTasks: AfterCommitTask[],
	settlement: 'commit' | 'rollback',
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
				`[transaction] a task queued after ${settlement} failed: ${error}`,
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
