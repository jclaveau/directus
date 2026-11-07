import type { ActionEventParams } from '@directus/types';
import type { Knex } from 'knex';
import { transaction } from './transaction.js';

/**
 * `transaction` for a service holding action events until the commit: the
 * events of an aborted attempt or of a rolled-back transaction never fire.
 */
export async function transactionHoldingActions<T = unknown>(
	knex: Knex,
	heldActionEvents: ActionEventParams[],
	handler: (trx: Knex) => Promise<T>,
	onRetry?: () => void,
): Promise<T> {
	try {
		return await transaction(knex, (trx) => {
			heldActionEvents.length = 0;

			return handler(trx);
		}, onRetry);
	}
	catch (failure) {
		heldActionEvents.length = 0;

		throw failure;
	}
}
