import { useLogger } from "../logger/index.js";
import { getDatabaseClient } from "../database/index.js";
import { isObject } from "@directus/utils";
import "knex";

//#region src/utils/transaction.ts
/**
* Execute the given handler within the current transaction or a newly created one
* if the current knex state isn't a transaction yet.
*
* Can be used to ensure the handler is run within a transaction,
* while preventing nested transactions.
*/
const transaction = async (knex$1, handler, forceNewTransaction = false) => {
	if (knex$1.isTransaction && forceNewTransaction === false) return handler(knex$1);
	else try {
		return await knex$1.transaction((trx) => handler(trx));
	} catch (error) {
		const client = getDatabaseClient(knex$1);
		if (!shouldRetryTransaction(client, error)) throw error;
		const MAX_ATTEMPTS = 3;
		const BASE_DELAY = 100;
		const logger = useLogger();
		for (let attempt = 0; attempt < MAX_ATTEMPTS; ++attempt) {
			const delay = 2 ** attempt * BASE_DELAY;
			await new Promise((resolve) => setTimeout(resolve, delay));
			logger.trace(`Restarting failed transaction (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
			try {
				return await knex$1.transaction((trx) => handler(trx));
			} catch (error$1) {
				if (!shouldRetryTransaction(client, error$1)) throw error$1;
			}
		}
		/** Initial execution + additional attempts */
		const attempts = 1 + MAX_ATTEMPTS;
		throw new Error(`Transaction failed after ${attempts} attempts`, { cause: error });
	}
};
function shouldRetryTransaction(client, error) {
	return isObject(error) && {
		cockroachdb: [{ code: "40001" }],
		sqlite: [{ code: "SQLITE_BUSY" }],
		mysql: [{ code: "ER_LOCK_DEADLOCK" }],
		mssql: [{
			code: "EREQUEST",
			number: "1205"
		}],
		oracle: [{ code: "ORA-00060" }],
		postgres: [{ code: "40P01" }],
		redshift: []
	}[client].some((code) => {
		return Object.entries(code).every(([key, value]) => String(error[key]) === value);
	});
}

//#endregion
export { transaction };