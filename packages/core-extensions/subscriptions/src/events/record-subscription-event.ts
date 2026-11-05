import type { Knex } from 'knex';

export type SubscriptionEventSource =
	| 'sync'
	| 'user'
	| 'provider_missing'
	| 'user_deleted'
	| 'plan_archived';

export type SubscriptionEvent = {
	subscriptionId: number;
	status: string;
	currentPeriodEnd: Date | number | string | null;
	cancelAtPeriodEnd: boolean;
	source: SubscriptionEventSource;
	userId: string | null;
	recordedAt: Date;
};

/** The history a dispute reads: `subscriptions` holds the last state only. */
export async function recordSubscriptionEvent(
	trx: Knex,
	subscriptionEvent: SubscriptionEvent,
): Promise<void> {
	await trx('subscription_events').insert({
		subscription: subscriptionEvent.subscriptionId,
		status: subscriptionEvent.status,
		current_period_end: subscriptionEvent.currentPeriodEnd,
		cancel_at_period_end: subscriptionEvent.cancelAtPeriodEnd,
		source: subscriptionEvent.source,
		user: subscriptionEvent.userId,
		date_created: subscriptionEvent.recordedAt,
	});
}
