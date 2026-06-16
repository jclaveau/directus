import database_default, { getDatabaseClient } from "../index.js";
import emitter_default from "../../emitter.js";
import { extractError } from "./dialects/mssql.js";
import { extractError as extractError$1 } from "./dialects/mysql.js";
import { extractError as extractError$2 } from "./dialects/oracle.js";
import { extractError as extractError$3 } from "./dialects/postgres.js";
import { extractError as extractError$4 } from "./dialects/sqlite.js";

//#region src/database/errors/translate.ts
/**
* Translates an error thrown by any of the databases into a pre-defined Exception. Currently
* supports:
* - Invalid Foreign Key
* - Not Null Violation
* - Record Not Unique
* - Value Out of Range
* - Value Too Long
*/
async function translateDatabaseError(error, data) {
	const client = getDatabaseClient();
	let defaultError;
	switch (client) {
		case "mysql":
			defaultError = extractError$1(error, data);
			break;
		case "cockroachdb":
		case "postgres":
			defaultError = extractError$3(error, data);
			break;
		case "sqlite":
			defaultError = extractError$4(error, data);
			break;
		case "oracle":
			defaultError = extractError$2(error);
			break;
		case "mssql":
			defaultError = await extractError(error, data);
			break;
	}
	return await emitter_default.emitFilter("database.error", defaultError, { client }, {
		database: database_default(),
		schema: null,
		accountability: null
	});
}

//#endregion
export { translateDatabaseError };