import type { Knex } from 'knex';
import { readInsertedId } from './create-pending-subscription.js';

export type SubscriptionMemberAdd = {
	subscription: number;
	user: string;
};

/** A manager pays and decides: cancel, resume, add beneficiaries. */
export async function addManager(
	trx: Knex,
	{ subscription, user }: SubscriptionMemberAdd,
): Promise<number> {
	const [insertedRow] = await trx('subscription_managers')
		.insert({ subscription, user }, ['id']);

	return readInsertedId(insertedRow);
}
