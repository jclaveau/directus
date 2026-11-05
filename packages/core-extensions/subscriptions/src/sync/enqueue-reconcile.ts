import type { Knex } from 'knex';
import { TERMINAL_STATUSES } from '../constants.js';
import type { SubscriptionProviders } from '../providers/types.js';
import { enqueueSync } from '../queue/sync-queue.js';

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

	const disabledProviders = new Set<string>();
	let enqueuedCount = 0;

	for (const reconciledRow of reconciledRows) {
		const rowProvider = enabledProviders.get(reconciledRow.provider);

		if (rowProvider === undefined) {
			disabledProviders.add(reconciledRow.provider);
			continue;
		}

		await enqueueSync(database, {
			provider: reconciledRow.provider,
			resourceId: rowProvider.composeResourceId({
				subscriptionId: reconciledRow.provider_subscription_id,
				customerId: reconciledRow.provider_customer_id,
			}),
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
