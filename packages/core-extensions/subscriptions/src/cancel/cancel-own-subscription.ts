import { ForbiddenError } from '@directus/errors';
import type { Knex } from 'knex';
import { TERMINAL_STATUSES } from '../constants.js';
import {
	NoSubscriptionToCancelError,
	SeveralSubscriptionsToCancelError,
} from '../errors.js';
import { findProvider } from '../providers/create-providers.js';
import type { SubscriptionProviders } from '../providers/types.js';
import { enqueueSync } from '../queue/sync-queue.js';
import { listManagedSubscriptions } from './list-managed-subscriptions.js';
import { recordCancelRequest } from './record-cancel-request.js';

export type OwnSubscriptionCancel = {
	database: Knex;
	enabledProviders: SubscriptionProviders;
	userId: string | null;
	/** Required once the user manages several ongoing subscriptions. */
	subscriptionId?: number | undefined;
};

export async function cancelOwnSubscription({
	database,
	enabledProviders,
	userId,
	subscriptionId,
}: OwnSubscriptionCancel): Promise<void> {
	if (userId === null) {
		throw new ForbiddenError();
	}

	const ongoingQuery = database('subscriptions')
		.select(
			'subscriptions.id',
			'subscriptions.provider',
			'subscriptions.provider_subscription_id',
			'subscriptions.status',
			'subscriptions.current_period_end',
			'subscriptions.provider_customer_id',
		)
		.whereIn('subscriptions.id', listManagedSubscriptions(database, userId))
		.whereNotNull('subscriptions.provider_subscription_id')
		.where('subscriptions.cancel_at_period_end', false)
		.whereNotIn('subscriptions.status', TERMINAL_STATUSES);

	if (subscriptionId !== undefined) {
		ongoingQuery.where('subscriptions.id', subscriptionId);
	}

	const ongoingSubscriptions = await ongoingQuery;

	const [ownSubscription, ...otherSubscriptions] = ongoingSubscriptions;

	if (ownSubscription === undefined) {
		throw new NoSubscriptionToCancelError();
	}

	if (otherSubscriptions.length > 0) {
		throw new SeveralSubscriptionsToCancelError({
			subscriptionCount: ongoingSubscriptions.length,
		});
	}

	const subscriptionProvider = findProvider(
		enabledProviders,
		ownSubscription.provider,
	);

	const resourceId = subscriptionProvider.composeResourceId({
		subscriptionId: ownSubscription.provider_subscription_id,
		customerId: ownSubscription.provider_customer_id,
	});

	// A provider refusal answers 500 with no sync queued: the hourly reconcile
	// closes a row the provider no longer has, then a retry works.
	await subscriptionProvider.cancelAtPeriodEnd(resourceId);

	await database.transaction(async (trx) => {
		await enqueueSync(trx, {
			provider: ownSubscription.provider,
			resourceId,
		});

		await recordCancelRequest(trx, {
			subscription: ownSubscription,
			source: 'user',
			userId,
			requestedAt: new Date(),
		});
	});
}
