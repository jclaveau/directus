import { transaction } from "./transaction.js";

//#region src/utils/transaction-holding-actions.ts
/**
* `transaction` for a service holding action events until the commit: the
* events of an aborted attempt or of a failed transaction never fire. A caller's
* transaction ends later, so only its `bypassEmitAction` can hold them past that.
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