import { ForbiddenError } from '@directus/errors';
import type { Knex } from 'knex';
import { TERMINAL_STATUSES } from '../constants.js';
import {
	ArchivedPlanResumeError,
	NoSubscriptionToResumeError,
	SeveralSubscriptionsToResumeError,
} from '../errors.js';
import { recordSubscriptionEvent } from '../events/record-subscription-event.js';
import { findProvider } from '../providers/create-providers.js';
import type { SubscriptionProviders } from '../providers/types.js';
import { enqueueSync } from '../queue/sync-queue.js';
import { listManagedSubscriptions } from './list-managed-subscriptions.js';

export type OwnSubscriptionResume = {
	database: Knex;
	enabledProviders: SubscriptionProviders;
	userId: string | null;
	/** Required once the user manages several canceled subscriptions. */
	subscriptionId?: number | undefined;
};

/**
 * Takes back the user's cancel while its period is still paid. Stripe clears
 * the cancel; Mollie starts a new subscription, stored by the sync with
 * `continues` naming the chain's last row.
 */
export async function resumeOwnSubscription({
	database,
	enabledProviders,
	userId,
	subscriptionId,
}: OwnSubscriptionResume): Promise<void> {
	if (userId === null) {
		throw new ForbiddenError();
	}

	const resumedAt = new Date();

	await database.transaction(async (trx) => {
		const canceledQuery = trx('subscriptions')
			.join(
				'subscription_plans',
				'subscription_plans.id',
				'subscriptions.plan',
			)
			.select(
				'subscriptions.id',
				'subscriptions.provider',
				'subscriptions.provider_subscription_id',
				'subscriptions.status',
				'subscriptions.current_period_end',
				'subscriptions.provider_customer_id',
				'subscription_plans.code as plan_code',
				'subscription_plans.status as plan_status',
			)
			.whereIn('subscriptions.id', listManagedSubscriptions(trx, userId))
			.where('subscriptions.cancel_at_period_end', true)
			.where('subscriptions.current_period_end', '>', resumedAt)
			// A Stripe subscription canceled at Stripe is over: nothing to take back.
			.whereNot((stripeEnded) => {
				stripeEnded
					.where('subscriptions.provider', 'stripe')
					.where('subscriptions.status', 'canceled');
			})
			.orderBy('subscriptions.id');

		if (subscriptionId !== undefined) {
			canceledQuery.where('subscriptions.id', subscriptionId);
		}

		// Two resumes of one row would each create a Mollie subscription.
		if (trx.client.dialect === 'postgresql') {
			canceledQuery.forUpdate('subscriptions');
		}

		const resumableSubscriptions = [];

		for (const canceledRow of await canceledQuery) {
			if (!await isContinuedOngoing(trx, canceledRow.id, resumedAt)) {
				resumableSubscriptions.push(canceledRow);
			}
		}

		const [canceledSubscription, ...otherSubscriptions] = resumableSubscriptions;

		if (canceledSubscription === undefined) {
			throw new NoSubscriptionToResumeError();
		}

		if (otherSubscriptions.length > 0) {
			throw new SeveralSubscriptionsToResumeError({
				subscriptionCount: resumableSubscriptions.length,
			});
		}

		if (canceledSubscription.plan_status === 'archived') {
			throw new ArchivedPlanResumeError({
				planCode: canceledSubscription.plan_code,
			});
		}

		const subscriptionProvider = findProvider(
			enabledProviders,
			canceledSubscription.provider,
		);

		const resumedSubscription = await subscriptionProvider.resumeCancel({
			subscriptionId: canceledSubscription.provider_subscription_id,
			customerId: canceledSubscription.provider_customer_id,
			periodEnd: new Date(canceledSubscription.current_period_end),
		});

		await enqueueSync(trx, {
			provider: canceledSubscription.provider,
			resourceId: resumedSubscription.resourceId,
		});

		// The new Mollie row is the sync's to write, from what Mollie holds: the
		// canceled row stays canceled, its event names who resumed it.
		if (!resumedSubscription.isNewSubscription) {
			await trx('subscriptions')
				.where('id', canceledSubscription.id)
				.update({
					cancel_at_period_end: false,
					user_updated: userId,
					date_updated: resumedAt,
				});
		}

		await recordSubscriptionEvent(trx, {
			subscriptionId: canceledSubscription.id,
			status: canceledSubscription.status,
			currentPeriodEnd: canceledSubscription.current_period_end,
			cancelAtPeriodEnd: resumedSubscription.isNewSubscription,
			source: 'user',
			userId,
			recordedAt: resumedAt,
		});
	});
}

/**
 * A resume canceled before its first charge gives the row back: the user may
 * change their mind again without paying a day twice.
 */
async function isContinuedOngoing(
	trx: Knex,
	subscriptionId: number,
	resumedAt: Date,
): Promise<boolean> {
	const chainRow = await trx('subscriptions')
		.select('id', 'status', 'current_period_end')
		.where('continues', subscriptionId)
		.first();

	if (chainRow === undefined) {
		return false;
	}

	const isOngoing = !TERMINAL_STATUSES.includes(chainRow.status)
		|| (chainRow.current_period_end !== null
			&& new Date(chainRow.current_period_end) > resumedAt);

	return isOngoing || await isContinuedOngoing(trx, chainRow.id, resumedAt);
}
