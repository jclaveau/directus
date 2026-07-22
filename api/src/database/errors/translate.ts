import getDatabase, { getDatabaseClient } from '../index.js';
import emitter from '../../emitter.js';
import { useLogger } from '../../logger/index.js';
import { extractError as mssql } from './dialects/mssql.js';
import { extractError as mysql } from './dialects/mysql.js';
import { extractError as oracle } from './dialects/oracle.js';
import { extractError as postgres } from './dialects/postgres.js';
import { extractError as sqlite } from './dialects/sqlite.js';
import type { Knex } from 'knex';
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
	database?: Knex,
	operatedCollection?: string,
): Promise<any> {
	// Dispatch on the connection the query actually ran on — a granted named
	// connection may be a different client than the default pool.
	const client = getDatabaseClient(database);

	let translated: any;

	switch (client) {
		case 'mysql':
			translated = mysql(error, data, operatedCollection);
			break;
		case 'cockroachdb':
		case 'postgres':
			translated = postgres(error, data, operatedCollection);
			break;
		case 'sqlite':
			translated = sqlite(error, data, operatedCollection);
			break;
		case 'oracle':
			translated = oracle(error);
			break;
		case 'mssql':
			translated = await mssql(error, data);
			break;
		default:
			translated = error;
	}

	// When a raw driver error was translated to a Directus error, keep its raw
	// message: logged server-side here, and the error handler exposes it in the
	// response in development only (like `stack`). It carries SQL text + values —
	// exactly what translation strips from prod responses — so it never leaks there.
	if (translated !== error && translated instanceof Error) {
		Object.defineProperty(translated, 'rawDatabaseError', {
			value: error.message,
			enumerable: false,
			configurable: true,
		});

		useLogger().debug(error, 'Translated database error');
	}

	return translated;
}

/**
 * Dialect translation plus the `database.error` filter hook. Used at the write
 * call-sites.
 */
export async function translateDatabaseError(
	error: SQLError,
	data: Partial<Item>,
	database?: Knex,
	operatedCollection?: string,
): Promise<any> {
	const defaultError = await extractDatabaseError(
		error,
		data,
		database,
		operatedCollection,
	);

	const hookError = await emitter.emitFilter(
		'database.error',
		defaultError,
		{ client: getDatabaseClient(database) },
		{
			database: database ?? getDatabase(),
			schema: null,
			accountability: null,
		},
	);

	return hookError;
}
