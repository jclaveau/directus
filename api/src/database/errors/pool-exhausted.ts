import type { DatabasePoolExhaustedReason } from '@directus/errors';
import { isObject } from '@directus/utils';

/**
 * Classify a raw driver/pool error as a pool-exhaustion reason, or null if it isn't one. Pool
 * errors carry no SQLSTATE for the tarn/pgbouncer cases, so those are matched on their message.
 */
export function getDatabasePoolExhaustedReason(
	error: unknown,
): DatabasePoolExhaustedReason | null {
	if (!isObject(error)) {
		return null;
	}

	const code = typeof error['code'] === 'string'
		? error['code']
		: '';

	const rawMessage = typeof error['message'] === 'string'
		? error['message']
		: '';

	const message = rawMessage.toLowerCase();

	// Postgres: no backend connection slots left
	if (code === '53300') {
		return 'too_many_connections';
	}

	// pgbouncer: global client-socket cap hit while establishing the connection
	if (message.includes('no more connections allowed')) {
		return 'max_client_connections';
	}

	// pgbouncer: waited in the queue past query_wait_timeout for a server connection
	if (message.includes('query_wait_timeout')) {
		return 'pool_queue_timeout';
	}

	// knex/tarn: client-side pool.max reached, acquiring a connection timed out
	const isAcquireTimeout =
		message.includes('timeout acquiring a connection') ||
		message.includes('pool is probably full');

	if (isAcquireTimeout) {
		return 'client_pool_timeout';
	}

	return null;
}
