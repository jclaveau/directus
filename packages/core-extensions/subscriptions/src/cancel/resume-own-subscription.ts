import { ForbiddenError } from '@directus/errors';
import type { Knex } from 'knex';
import {
	ArchivedPlanResumeError,
	NoSubscriptionToResumeError,
	SeveralSubscriptionsToResumeError,
} from '../errors.js';
import { recordSubscriptionEvent } from '../events/record-subscription-event.js';
import { findProvider } from '../providers/create-providers.js';
import type { SubscriptionProviders } from '../providers/types.js';
import { enqueueSync } from '../queue/sync-queue.js';

export type OwnSubscriptionResume = {
	database: Knex;
	enabledProviders: SubscriptionProviders;
	userId: string | null;
};

/**
 * Takes back the user's cancel while its period is still paid. Stripe clears
 * the cancel; Mollie starts a new subscription, stored by the sync with
 * `resumes` naming the old row.
 */
export async function resumeOwnSubscription({
	database,
	enabledProviders,
	userId,
}: OwnSubscriptionResume): Promise<void> {
	if (userId === null) {
		throw new ForbiddenError();
	}

	const resumedAt = new Date();

	await database.transaction(async (trx) => {
		const canceledQuery = trx('subscriptions')
			.join('subscribers', 'subscribers.id', 'subscriptions.subscriber')
			.join(
				'subscriber_customers',
				'subscriber_customers.id',
				'subscriptions.customer',
			)
			.join(
				'subscription_plan_references',
				'subscription_plan_references.id',
				'subscriptions.plan_reference',
			)
			.join(
				'subscription_plans',
				'subscription_plans.id',
				'subscription_plan_references.plan',
			)
			.select(
				'subscriptions.id',
				'subscriptions.provider',
				'subscriptions.provider_subscription_id',
				'subscriptions.status',
				'subscriptions.current_period_end',
				'subscriber_customers.provider_customer_id',
				'subscription_plans.code as plan_code',
				'subscription_plans.status as plan_status',
			)
			.where('subscribers.user', userId)
			.where('subscriptions.cancel_at_period_end', true)
			.where('subscriptions.current_period_end', '>', resumedAt)
			// A Stripe subscription canceled at Stripe is over: nothing to take back.
			.whereNot((stripeEnded) => {
				stripeEnded
					.where('subscriptions.provider', 'stripe')
					.where('subscriptions.status', 'canceled');
			})
			.whereNotExists(
				trx('subscriptions as resuming_subscriptions')
					.select('resuming_subscriptions.id')
					.whereColumn(
						'resuming_subscriptions.resumes',
						'subscriptions.id',
					),
			);

		// Two resumes of one row would each create a Mollie subscription.
		if (trx.client.dialect === 'postgresql') {
			canceledQuery.forUpdate('subscriptions');
		}

		const canceledSubscriptions = await canceledQuery;
		const [canceledSubscription, ...otherSubscriptions] = canceledSubscriptions;

		if (canceledSubscription === undefined) {
			throw new NoSubscriptionToResumeError();
		}

		if (otherSubscriptions.length > 0) {
			throw new SeveralSubscriptionsToResumeError({
				subscriptionCount: canceledSubscriptions.length,
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
