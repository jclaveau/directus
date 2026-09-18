import { useLogger } from "../../logger/index.js";
import database_default, { getDatabaseClient } from "../index.js";
import emitter_default from "../../emitter.js";
import { extractError } from "./dialects/mssql.js";
import { extractError as extractError$1 } from "./dialects/mysql.js";
import { extractError as extractError$2 } from "./dialects/oracle.js";
import { extractError as extractError$3 } from "./dialects/postgres.js";
import { extractError as extractError$4 } from "./dialects/sqlite.js";

//#region src/database/errors/translate.ts
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
async function extractDatabaseError(error, data, database, context) {
	const client = getDatabaseClient(database);
	let translated;
	switch (client) {
		case "mysql":
			translated = extractError$1(error, data, context);
			break;
		case "cockroachdb":
		case "postgres":
			translated = extractError$3(error, data, context);
			break;
		case "sqlite":
			translated = extractError$4(error, data, context);
			break;
		case "oracle":
			translated = extractError$2(error);
			break;
		case "mssql":
			translated = await extractError(error, data);
			break;
		default: translated = error;
	}
	if (translated !== error && translated instanceof Error) {
		Object.defineProperty(translated, "rawDatabaseError", {
			value: error.message,
			enumerable: false,
			configurable: true
		});
		useLogger().debug(error, "Translated database error");
	}
	return translated;
}
/**
* Dialect translation plus the `database.error` filter hook. Used at the write
* call-sites.
*/
async function translateDatabaseError(error, data, database, context) {
	const defaultError = await extractDatabaseError(error, data, database, context);
	return await emitter_default.emitFilter("database.error", defaultError, { client: getDatabaseClient(database) }, {
		database: database ?? database_default(),
		schema: null,
		accountability: null
	});
}

//#endregion
export { extractDatabaseError, translateDatabaseError };