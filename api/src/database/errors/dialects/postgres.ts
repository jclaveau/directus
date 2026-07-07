import {
	ContainsNullValuesError,
	DatabasePoolExhaustedError,
	InvalidForeignKeyError,
	NotNullViolationError,
	RecordNotUniqueError,
	ValueOutOfRangeError,
	ValueTooLongError,
	type DatabasePoolExhaustedReason,
} from '@directus/errors';
import { isObject } from '@directus/utils';
import type { PostgresError } from './types.js';
import type { Item } from '@directus/types';

enum PostgresErrorCodes {
	FOREIGN_KEY_VIOLATION = '23503',
	NOT_NULL_VIOLATION = '23502',
	NUMERIC_VALUE_OUT_OF_RANGE = '22003',
	UNIQUE_VIOLATION = '23505',
	VALUE_LIMIT_VIOLATION = '22001',
}

export function extractError(error: PostgresError, data: Partial<Item>): PostgresError | Error {
	// pgbouncer/tarn/postgres pool exhaustion (the connection tier is tagged on by the caller)
	const poolError = getPoolExhaustedError(error);

	if (poolError) {
		return poolError;
	}

	switch (error.code) {
		case PostgresErrorCodes.UNIQUE_VIOLATION:
			return uniqueViolation();
		case PostgresErrorCodes.NUMERIC_VALUE_OUT_OF_RANGE:
			return numericValueOutOfRange();
		case PostgresErrorCodes.VALUE_LIMIT_VIOLATION:
			return valueLimitViolation();
		case PostgresErrorCodes.NOT_NULL_VIOLATION:
			return notNullViolation();
		case PostgresErrorCodes.FOREIGN_KEY_VIOLATION:
			return foreignKeyViolation();
		default:
			return error;
	}

	function uniqueViolation() {
		const { table, detail } = error;

		const betweenParens = /\(([^)]+)\)/g;
		const matches = detail.match(betweenParens);

		if (!matches) return error;

		const collection = table;
		const field = matches[0].slice(1, -1);

		return new RecordNotUniqueError({
			collection,
			field,
			value: field ? data[field] : null,
		});
	}

	function numericValueOutOfRange() {
		const regex = /"(.*?)"/g;
		const matches = error.message.match(regex);

		if (!matches) return error;

		const collection = matches[0].slice(1, -1);
		const field = matches[1]?.slice(1, -1) ?? null;

		return new ValueOutOfRangeError({
			collection,
			field,
			value: field ? data[field] : null,
		});
	}

	function valueLimitViolation() {
		/**
		 * NOTE:
		 * Postgres doesn't return the offending column
		 */

		const regex = /"(.*?)"/g;
		const matches = error.message.match(regex);

		if (!matches) return error;

		const collection = matches[0].slice(1, -1);
		const field = matches[1]?.slice(1, -1) ?? null;

		return new ValueTooLongError({
			collection,
			field,
			value: field ? data[field] : null,
		});
	}

	function notNullViolation() {
		const { table, column } = error;
		if (!column) return error;

		if (error.message.endsWith('contains null values')) {
			return new ContainsNullValuesError({ collection: table, field: column });
		}

		return new NotNullViolationError({
			collection: table,
			field: column,
		});
	}

	function foreignKeyViolation() {
		const { table, detail } = error;

		const betweenParens = /\(([^)]+)\)/g;
		const matches = detail.match(betweenParens);

		if (!matches) return error;

		const collection = table;
		const field = matches[0].slice(1, -1);

		return new InvalidForeignKeyError({
			collection,
			field,
			value: field ? data[field] : null,
		});
	}
}

/**
 * Turn a raw pg/pgbouncer/tarn error into a DatabasePoolExhaustedError, or null if it isn't one.
 * The tarn/pgbouncer cases carry no SQLSTATE, so they're matched on the message. The connection
 * tier is left null here for the caller (the request) to tag on.
 */
export function getPoolExhaustedError(error: unknown): DatabasePoolExhaustedError | null {
	if (!isObject(error)) {
		return null;
	}

	const code = typeof error['code'] === 'string'
		? error['code']
		: '';

	const message = (typeof error['message'] === 'string'
		? error['message']
		: ''
	).toLowerCase();

	const isAcquireTimeout =
		message.includes('timeout acquiring a connection') ||
		message.includes('pool is probably full');

	let reason: DatabasePoolExhaustedReason | null = null;

	if (code === '53300') {
		reason = 'too_many_connections'; // postgres: no backend connection slots left
	}
	else if (message.includes('no more connections allowed')) {
		reason = 'max_client_connections'; // pgbouncer: global client-socket cap
	}
	else if (message.includes('query_wait_timeout')) {
		reason = 'pool_queue_timeout'; // pgbouncer: server-connection queue timeout
	}
	else if (isAcquireTimeout) {
		reason = 'client_pool_timeout'; // knex/tarn: pool.max acquire timeout
	}

	if (reason === null) {
		return null;
	}

	return new DatabasePoolExhaustedError({ reason, connection: null });
}
