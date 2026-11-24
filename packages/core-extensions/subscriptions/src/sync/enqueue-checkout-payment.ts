import type { Knex } from 'knex';
import type { SubscriptionProvider } from '../providers/types.js';
import { enqueueSync } from '../queue/sync-queue.js';

export type PendingCheckout = {
	id: number;
	provider: string;
	provider_customer_id: string;
};

/** Queues the checkout's paid payment, whose sync starts the subscription. */
export async function enqueueCheckoutPayment(
	database: Knex,
	subscriptionProvider: SubscriptionProvider,
	pendingCheckout: PendingCheckout,
): Promise<boolean> {
	const paymentResourceId = await subscriptionProvider.findCheckoutPayment?.({
		customerId: pendingCheckout.provider_customer_id,
		directusSubscription: pendingCheckout.id,
	}) ?? null;

	if (paymentResourceId === null) {
		return false;
	}

	await enqueueSync(database, {
		provider: pendingCheckout.provider,
		resourceId: paymentResourceId,
	});

	return true;
}
