import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import type { Accountability } from '@directus/types';
import type { Knex } from 'knex';
import { recordCancelRequest } from '../cancel/record-cancel-request.js';
import { TERMINAL_STATUSES } from '../constants.js';
import { findProvider } from '../providers/create-providers.js';
import type { SubscriptionProviders } from '../providers/types.js';
import { enqueueSync } from '../queue/sync-queue.js';

const PLAN_ID_PATTERN = /^\d{1,9}$/;

export type PlanArchive = {
	database: Knex;
	enabledProviders: SubscriptionProviders;
	planId: string;
	confirmation: unknown;
	accountability: Accountability | null;
};

export type ArchivedPlan = {
	status: 'archived';
	ending_subscriptions: number;
};

/**
 * Ends the plan's subscriptions at their period end, without refund. A failure
 * half way leaves the plan unarchived; the ones already ended no longer count,
 * so a retry asks for a smaller sentence and carries on. A provider refusal
 * answers 500 with no sync queued: the hourly reconcile closes a row the
 * provider no longer has, then the retry carries on.
 */
export async function archivePlan({
	database,
	enabledProviders,
	planId,
	confirmation,
	accountability,
}: PlanArchive): Promise<ArchivedPlan> {
	if (accountability?.admin !== true) {
		throw new ForbiddenError();
	}

	if (!PLAN_ID_PATTERN.test(planId)) {
		throw new InvalidPayloadError({
			reason: `Plan id ${JSON.stringify(planId)} must be an integer`,
		});
	}

	const storedPlan = await database('subscription_plans')
		.select('id')
		.where('id', Number(planId))
		.first();

	if (storedPlan === undefined) {
		throw new ForbiddenError();
	}

	const endingSubscriptions = await database('subscriptions')
		.select(
			'id',
			'provider',
			'provider_subscription_id',
			'status',
			'current_period_end',
			'provider_customer_id',
		)
		.where('plan', storedPlan.id)
		// A pending row is no customer yet: nothing at the provider to end.
		.whereNotNull('provider_subscription_id')
		.where('cancel_at_period_end', false)
		.whereNotIn('status', TERMINAL_STATUSES);

	const expectedSentence = composeArchiveSentence(endingSubscriptions.length);

	if (endingSubscriptions.length > 0 && confirmation !== expectedSentence) {
		throw new InvalidPayloadError({
			reason: `Type ${JSON.stringify(expectedSentence)} in "confirmation"`,
		});
	}

	// Resolved before the first cancel: a disabled provider ends nothing.
	const plannedCancels = endingSubscriptions.map((endingSubscription) => {
		const subscriptionProvider = findProvider(
			enabledProviders,
			endingSubscription.provider,
		);

		return {
			endingSubscription,
			subscriptionProvider,
			resourceId: subscriptionProvider.composeResourceId({
				subscriptionId: endingSubscription.provider_subscription_id,
				customerId: endingSubscription.provider_customer_id,
			}),
		};
	});

	for (const plannedCancel of plannedCancels) {
		await plannedCancel.subscriptionProvider
			.cancelAtPeriodEnd(plannedCancel.resourceId);

		await database.transaction(async (trx) => {
			await enqueueSync(trx, {
				provider: plannedCancel.endingSubscription.provider,
				resourceId: plannedCancel.resourceId,
			});

			await recordCancelRequest(trx, {
				subscription: plannedCancel.endingSubscription,
				source: 'plan_archived',
				userId: accountability.user ?? null,
				requestedAt: new Date(),
			});
		});
	}

	await database('subscription_plans')
		.where('id', storedPlan.id)
		.update({ status: 'archived' });

	return {
		status: 'archived',
		ending_subscriptions: endingSubscriptions.length,
	};
}

function composeArchiveSentence(subscriptionCount: number): string {
	return subscriptionCount === 1
		? 'End 1 subscription and lose this customer'
		: `End ${subscriptionCount} subscriptions and lose these customers`;
}
