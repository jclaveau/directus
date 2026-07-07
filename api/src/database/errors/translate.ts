import getDatabase, { getDatabaseClient } from '../index.js';
import emitter from '../../emitter.js';
import { extractError as mssql } from './dialects/mssql.js';
import { extractError as mysql } from './dialects/mysql.js';
import { extractError as oracle } from './dialects/oracle.js';
import { extractError as postgres } from './dialects/postgres.js';
import { extractError as sqlite } from './dialects/sqlite.js';
import type { SQLError } from './dialects/types.js';
import type { Item } from '@directus/types';

/**
 * Dispatch a raw driver error to its dialect translator → a pre-defined
 * Directus error, or the raw error untouched if unrecognized. Translates:
 * Invalid Foreign Key, Not Null Violation, Record Not Unique, Value Out of
 * Range, Value Too Long, and (postgres) DB pool exhaustion.
 *
 * PURE — no `database.error` hook — so the error handler can run it on ANY
 * unknown error to catch DB/pool errors on reads too, without firing the hook
 * for non-DB errors.
 */
export async function extractDatabaseError(
	error: SQLError,
	data: Partial<Item>,
): Promise<any> {
	const client = getDatabaseClient();

	switch (client) {
		case 'mysql':
			return mysql(error, data);
		case 'cockroachdb':
		case 'postgres':
			return postgres(error, data);
		case 'sqlite':
			return sqlite(error, data);
		case 'oracle':
			return oracle(error);
		case 'mssql':
			return await mssql(error, data);
		default:
			return error;
	}
}

/**
 * Dialect translation plus the `database.error` filter hook. Used at the write
 * call-sites.
 */
export async function translateDatabaseError(
	error: SQLError,
	data: Partial<Item>,
): Promise<any> {
	const defaultError = await extractDatabaseError(error, data);

	const hookError = await emitter.emitFilter(
		'database.error',
		defaultError,
		{ client: getDatabaseClient() },
		{
			database: getDatabase(),
			schema: null,
			accountability: null,
		},
	);

	return hookError;
}
