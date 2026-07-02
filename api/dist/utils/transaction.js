import { useLogger } from "../logger/index.js";
import { getDatabaseClient } from "../database/index.js";
import { isObject } from "@directus/utils";

//#region src/utils/transaction.ts
/**
* Execute the given handler within the current transaction or a newly created one
* if the current knex state isn't a transaction yet.
*
* Can be used to ensure the handler is run within a transaction,
* while preventing nested transactions.
*/
const transaction = async (knex, handler) => {
	if (knex.isTransaction) return handler(knex);
	else try {
		return await knex.transaction((trx) => handler(trx));
	} catch (error) {
		const client = getDatabaseClient(knex);
		if (!shouldRetryTransaction(client, error)) throw error;
		const MAX_ATTEMPTS = 3;
		const BASE_DELAY = 100;
		const logger = useLogger();
		for (let attempt = 0; attempt < MAX_ATTEMPTS; ++attempt) {
			const delay = 2 ** attempt * BASE_DELAY;
			await new Promise((resolve) => setTimeout(resolve, delay));
			logger.trace(`Restarting failed transaction (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
			try {
				return await knex.transaction((trx) => handler(trx));
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
	return isObject(error) && (client === "cockroachdb" && error["code"] === "40001" || client === "sqlite" && error["code"] === "SQLITE_BUSY");
}

//#endregion
export { transaction };