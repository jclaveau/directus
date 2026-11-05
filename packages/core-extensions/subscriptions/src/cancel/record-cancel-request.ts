import type { Knex } from 'knex';
import {
	recordSubscriptionEvent,
	type SubscriptionEventSource,
} from '../events/record-subscription-event.js';

export type CancelRequest = {
	subscription: {
		id: number;
		status: string;
		current_period_end: Date | number | string | null;
	};
	source: SubscriptionEventSource;
	userId: string | null;
	requestedAt: Date;
};

/** Written after the provider accepted, naming who asked: no webhook can. */
export async function recordCancelRequest(
	trx: Knex,
	{ subscription, source, userId, requestedAt }: CancelRequest,
): Promise<void> {
	await trx('subscriptions')
		.where('id', subscription.id)
		.update({
			cancel_at_period_end: true,
			user_updated: userId,
			date_updated: requestedAt,
		});

	await recordSubscriptionEvent(trx, {
		subscriptionId: subscription.id,
		status: subscription.status,
		currentPeriodEnd: subscription.current_period_end,
		cancelAtPeriodEnd: true,
		source,
		userId,
		recordedAt: requestedAt,
	});
}
