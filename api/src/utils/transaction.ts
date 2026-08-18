import { isObject } from '@directus/utils';
import { type Knex } from 'knex';
import { getDatabaseClient } from '../database/index.js';
import { useLogger } from '../logger/index.js';
import type { DatabaseClient } from '@directus/types';

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
		// nested caller runs "after the transaction" actually runs inside it. That is
		// what makes a hook-invoked `ItemsService` write purge the scoped cache
		// pre-commit — a reader in that window re-indexes uncommitted rows under the
		// tag just dropped, and a slow Redis holds the connection `idle in transaction`.
		// The deferred drain belongs here:
		// https://github.com/jclaveau/directus/issues/363
		return handler(knex);
	} else {
		try {
			return await knex.transaction((trx) => handler(trx));
		} catch (error) {
			const client = getDatabaseClient(knex);

			// Only sqlite / cockroach reach the retry loop: both hand an aborted
			// transaction back and require the CLIENT to re-run it (no server-side
			// recovery). cockroach's optimistic SERIALIZABLE aborts a txn that lost
			// a write race at commit (40001); sqlite's single writer rejects a
			// concurrent write with SQLITE_BUSY. postgres blocks on locks instead
			// of returning a retry code, so it never lands here.
			if (!shouldRetryTransaction(client, error)) throw error;

			const MAX_ATTEMPTS = 3;
			const BASE_DELAY = 100;

			const logger = useLogger();

			for (let attempt = 0; attempt < MAX_ATTEMPTS; ++attempt) {
				const delay = 2 ** attempt * BASE_DELAY;

				await new Promise((resolve) => setTimeout(resolve, delay));

				logger.trace(`Restarting failed transaction (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);

				// Roll back caller state (e.g. the mutation counter) so a re-run of the
				// handler doesn't accumulate its side effects onto the previous attempt.
				onRetry?.();

				try {
					return await knex.transaction((trx) => handler(trx));
				} catch (error) {
					if (!shouldRetryTransaction(client, error)) throw error;
				}
			}

			/** Initial execution + additional attempts */
			const attempts = 1 + MAX_ATTEMPTS;
			throw new Error(`Transaction failed after ${attempts} attempts`, { cause: error });
		}
	}
};

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
