import type { Knex } from 'knex';

export type SubscriptionEventSource =
	| 'sync'
	| 'user'
	| 'provider_missing'
	| 'user_deleted'
	| 'plan_archived'
	| 'webhook_unreadable';

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

/** A signed webhook nobody could read, kept so it can be read and replayed. */
export async function recordUnreadableWebhook(
	database: Knex,
	unreadableWebhook: { rawBody: Buffer; receivedAt: Date },
): Promise<void> {
	await database('subscription_events').insert({
		subscription: null,
		status: null,
		current_period_end: null,
		cancel_at_period_end: null,
		source: 'webhook_unreadable',
		user: null,
		date_created: unreadableWebhook.receivedAt,
		payload: unreadableWebhook.rawBody.toString('utf8'),
	});
}
