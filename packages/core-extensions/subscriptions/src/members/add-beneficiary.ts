import { InvalidPayloadError } from '@directus/errors';
import type { Knex } from 'knex';
import { BeneficiariesMaxReachedError } from '../errors.js';
import type { SubscriptionMemberAdd } from './add-manager.js';
import { readInsertedId } from './create-pending-subscription.js';

/**
 * Takes a seat of the plan's `beneficiaries_max`. The access comes with the
 * subscription's next sync, which the caller enqueues for a bound row.
 */
export async function addBeneficiary(
	trx: Knex,
	{ subscription, user }: SubscriptionMemberAdd,
): Promise<number> {
	const seatQuery = trx('subscriptions')
		.join('subscription_plans', 'subscription_plans.id', 'subscriptions.plan')
		.select(
			'subscription_plans.code',
			'subscription_plans.beneficiaries_max',
		)
		.where('subscriptions.id', subscription)
		.first();

	// Two adds racing for the last seat would both see it free.
	if (trx.client.dialect === 'postgresql') {
		seatQuery.forUpdate('subscriptions');
	}

	const subscribedPlan = await seatQuery;

	if (subscribedPlan === undefined) {
		throw new InvalidPayloadError({
			reason: `Subscription ${JSON.stringify(subscription)} does not exist`,
		});
	}

	const seatedBeneficiaries = await trx('subscription_beneficiaries')
		.select('user')
		.where('subscription', subscription);

	const isAlreadySeated = seatedBeneficiaries.some((seatedBeneficiary) => {
		return seatedBeneficiary.user === user;
	});

	if (isAlreadySeated) {
		throw new InvalidPayloadError({
			reason: `User ${JSON.stringify(user)} already benefits from`
				+ ` subscription ${JSON.stringify(subscription)}`,
		});
	}

	if (seatedBeneficiaries.length >= subscribedPlan.beneficiaries_max) {
		throw new BeneficiariesMaxReachedError({
			planCode: subscribedPlan.code,
			beneficiariesMax: subscribedPlan.beneficiaries_max,
		});
	}

	const [insertedRow] = await trx('subscription_beneficiaries')
		.insert({ subscription, user }, ['id']);

	return readInsertedId(insertedRow);
}
