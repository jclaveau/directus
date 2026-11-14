import type { Knex } from 'knex';
import { TERMINAL_STATUSES } from '../constants.js';
import type { SubscriptionProviders } from '../providers/types.js';
import {
	enqueueSync,
	MAX_SYNC_ATTEMPTS,
	PARKED_RETRY_DELAY_MS,
} from '../queue/sync-queue.js';

/**
 * Re-syncs every subscription a provider may still change, and every one
 * still holding access, since Mollie sends no webhook on a status change.
 */
export async function enqueueReconcile(
	database: Knex,
	enabledProviders: SubscriptionProviders,
): Promise<number> {
	const reconciledRows = await database('subscriptions')
		.join(
			'subscriber_customers',
			'subscriber_customers.id',
			'subscriptions.customer',
		)
		.select(
			'subscriptions.provider',
			'subscriptions.provider_subscription_id',
			'subscriber_customers.provider_customer_id',
		)
		.where((ongoingQuery) => {
			ongoingQuery.whereNotIn('subscriptions.status', TERMINAL_STATUSES)
				.orWhereNotNull('subscriptions.access');
		})
		.orderBy('subscriptions.id');

	// Without this the hourly run would undo the attempt ceiling. A row parked for
	// a day retries, as what failed may be fixed by now and a provider may never
	// send a webhook; a webhook, news about the subscription, re-arms it at once.
	const parkedRows = await database('subscription_sync_queue')
		.select('provider', 'resource_id')
		.where('attempts', '>=', MAX_SYNC_ATTEMPTS)
		.where(
			'next_attempt_at',
			'>',
			new Date(Date.now() - PARKED_RETRY_DELAY_MS),
		);

	const parkedResources = new Set(parkedRows.map((parkedRow) => {
		return `${parkedRow.provider} ${parkedRow.resource_id}`;
	}));

	const disabledProviders = new Set<string>();
	let enqueuedCount = 0;

	for (const reconciledRow of reconciledRows) {
		const rowProvider = enabledProviders.get(reconciledRow.provider);

		if (rowProvider === undefined) {
			disabledProviders.add(reconciledRow.provider);
			continue;
		}

		const resourceId = rowProvider.composeResourceId({
			subscriptionId: reconciledRow.provider_subscription_id,
			customerId: reconciledRow.provider_customer_id,
		});

		if (parkedResources.has(`${reconciledRow.provider} ${resourceId}`)) {
			continue;
		}

		await enqueueSync(database, {
			provider: reconciledRow.provider,
			resourceId,
		});

		enqueuedCount++;
	}

	if (disabledProviders.size > 0) {
		throw new Error(
			'Subscriptions of disabled providers'
			+ ` ${JSON.stringify([...disabledProviders])} were not reconciled`,
		);
	}

	return enqueuedCount;
}
