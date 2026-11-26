import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import type { Knex } from 'knex';
import type { SubscriptionProviders } from '../providers/types.js';
import { enqueueCheckoutPayment } from '../sync/enqueue-checkout-payment.js';

export type OwnCheckoutConfirm = {
	database: Knex;
	enabledProviders: SubscriptionProviders;
	userId: string | null;
	subscriptionId: number | undefined;
};

export type ConfirmedCheckout = {
	subscription: number;
	status: string;
	/** True when the paid payment was found and its sync queued. */
	sync_queued: boolean;
};

/**
 * The payer back from the checkout: a Mollie in-page payment sends no webhook,
 * so its paid payment is looked up here and synced within seconds.
 */
export async function confirmOwnCheckout({
	database,
	enabledProviders,
	userId,
	subscriptionId,
}: OwnCheckoutConfirm): Promise<ConfirmedCheckout> {
	if (userId === null) {
		throw new ForbiddenError();
	}

	if (subscriptionId === undefined) {
		throw new InvalidPayloadError({
			reason: '"subscription" is required',
		});
	}

	const paidCheckout = await database('subscriptions')
		.select('id', 'provider', 'status', 'provider_customer_id')
		.where({ id: subscriptionId, payer: userId })
		.first();

	if (paidCheckout === undefined) {
		throw new ForbiddenError();
	}

	const subscriptionProvider = enabledProviders.get(paidCheckout.provider);

	return {
		subscription: paidCheckout.id,
		status: paidCheckout.status,
		sync_queued: paidCheckout.status === 'pending'
			&& paidCheckout.provider_customer_id !== null
			&& subscriptionProvider !== undefined
			&& await enqueueCheckoutPayment(
				database,
				subscriptionProvider,
				paidCheckout,
			),
	};
}
