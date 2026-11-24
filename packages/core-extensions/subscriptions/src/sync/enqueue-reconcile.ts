import type { Knex } from 'knex';
import { TERMINAL_STATUSES } from '../constants.js';
import { readThrownMessage } from '../providers/read-thrown-message.js';
import type { SubscriptionProviders } from '../providers/types.js';
import {
	enqueueSync,
	MAX_SYNC_ATTEMPTS,
	PARKED_RETRY_DELAY_MS,
} from '../queue/sync-queue.js';
import { enqueueCheckoutPayment } from './enqueue-checkout-payment.js';

/** A checkout's payment pending longer than this is not looked for anymore. */
const PENDING_CHECKOUT_SEARCH_MS = 30 * 86_400_000;

/**
 * Re-syncs every subscription a provider may still change, and every one
 * still holding access, since Mollie sends no webhook on a status change.
 */
export async function enqueueReconcile(
	database: Knex,
	enabledProviders: SubscriptionProviders,
): Promise<number> {
	const reconciledRows = await database('subscriptions')
		.select(
			'subscriptions.provider',
			'subscriptions.provider_subscription_id',
			'subscriptions.provider_customer_id',
		)
		// A pending row has nothing at the provider to read yet.
		.whereNotNull('subscriptions.provider_subscription_id')
		.where((ongoingQuery) => {
			ongoingQuery.whereNotIn('subscriptions.status', TERMINAL_STATUSES)
				.orWhereExists(
					database('subscription_beneficiaries')
						.select('subscription_beneficiaries.id')
						.whereColumn(
							'subscription_beneficiaries.subscription',
							'subscriptions.id',
						)
						.whereNotNull('subscription_beneficiaries.access'),
				);
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

	// A checkout left before its return page: its payment may be paid all the same.
	const pendingCheckouts = await database('subscriptions')
		.select('id', 'provider', 'provider_customer_id')
		.where('status', 'pending')
		.whereNull('provider_subscription_id')
		.whereNotNull('provider_customer_id')
		.where(
			'date_updated',
			'>',
			new Date(Date.now() - PENDING_CHECKOUT_SEARCH_MS),
		)
		.orderBy('id');

	const searchFailures: string[] = [];

	for (const pendingCheckout of pendingCheckouts) {
		const checkoutProvider = enabledProviders.get(pendingCheckout.provider);

		if (checkoutProvider === undefined) {
			disabledProviders.add(pendingCheckout.provider);
			continue;
		}

		// One provider failing still queues the checkouts after it.
		try {
			if (await enqueueCheckoutPayment(
				database,
				checkoutProvider,
				pendingCheckout,
			)) {
				enqueuedCount++;
			}
		}
		catch (searchError) {
			searchFailures.push(
				`subscription ${JSON.stringify(pendingCheckout.id)}:`
				+ ` ${JSON.stringify(readThrownMessage(searchError))}`,
			);
		}
	}

	if (searchFailures.length > 0) {
		throw new Error(
			`Payments of pending checkouts were not searched:`
			+ ` ${searchFailures.join(', ')}`,
		);
	}

	if (disabledProviders.size > 0) {
		throw new Error(
			'Subscriptions of disabled providers'
			+ ` ${JSON.stringify([...disabledProviders])} were not reconciled`,
		);
	}

	return enqueuedCount;
}
