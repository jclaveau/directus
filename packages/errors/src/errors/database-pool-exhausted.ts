import { createError, ErrorCode } from '../index.js';

/**
 * Why the pool could not serve the request. Lets a client tell a transient
 * "pool full, back off and retry" from a harder "database out of connections".
 */
export type DatabasePoolExhaustedReason =
	| 'client_pool_timeout' // knex/tarn pool.max reached; acquiring a connection timed out
	| 'pool_queue_timeout' // pgbouncer queued the client past query_wait_timeout
	| 'max_client_connections' // pgbouncer max_client_conn reached
	| 'too_many_connections'; // postgres max_connections reached (SQLSTATE 53300)

export interface DatabasePoolExhaustedExtensions {
	reason: DatabasePoolExhaustedReason;
	connection: string | null;
}

const REASON_MESSAGES: Record<DatabasePoolExhaustedReason, string> = {
	client_pool_timeout:
		'the connection pool is full (acquiring a connection timed out)',
	pool_queue_timeout: 'the connection pool queue timed out',
	max_client_connections: 'the maximum number of client connections was reached',
	too_many_connections: 'the database has too many open connections',
};

export const messageConstructor = (extensions: DatabasePoolExhaustedExtensions) => {
	return `Database connection pool exhausted: ${
		REASON_MESSAGES[extensions.reason]
	}.`;
};

export const DatabasePoolExhaustedError =
	createError<DatabasePoolExhaustedExtensions>(
		ErrorCode.DatabasePoolExhausted,
		messageConstructor,
		429,
	);
