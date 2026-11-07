import { transaction } from "./transaction.js";

//#region src/utils/transaction-holding-actions.ts
/**
* `transaction` for a service holding action events until the commit: the
* events of an aborted attempt or of a rolled-back transaction never fire.
*/
async function transactionHoldingActions(knex, heldActionEvents, handler, onRetry) {
	try {
		return await transaction(knex, (trx) => {
			heldActionEvents.length = 0;
			return handler(trx);
		}, onRetry);
	} catch (failure) {
		heldActionEvents.length = 0;
		throw failure;
	}
}

//#endregion
export { transactionHoldingActions };