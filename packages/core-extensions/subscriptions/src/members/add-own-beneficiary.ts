import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import type { Knex } from 'knex';
import { findProvider } from '../providers/create-providers.js';
import type { SubscriptionProviders } from '../providers/types.js';
import { enqueueSync } from '../queue/sync-queue.js';
import { addBeneficiary } from './add-beneficiary.js';

export type OwnBeneficiaryAdd = {
	database: Knex;
	enabledProviders: SubscriptionProviders;
	userId: string | null;
	requestBody: unknown;
};

const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** `POST /subscriptions/beneficiaries`: a manager seats a user on the plan. */
export async function addOwnBeneficiary({
	database,
	enabledProviders,
	userId,
	requestBody,
}: OwnBeneficiaryAdd): Promise<number> {
	if (userId === null) {
		throw new ForbiddenError();
	}

	const { subscription, user } = readBeneficiaryPayload(requestBody);

	return await database.transaction(async (trx) => {
		const managedSubscription = await trx('subscriptions')
			.join(
				'subscription_managers',
				'subscription_managers.subscription',
				'subscriptions.id',
			)
			.select(
				'subscriptions.provider',
				'subscriptions.provider_subscription_id',
				'subscriptions.provider_customer_id',
			)
			.where('subscriptions.id', subscription)
			.where('subscription_managers.user', userId)
			.first();

		// Not telling a stranger which subscriptions exist.
		if (managedSubscription === undefined) {
			throw new ForbiddenError();
		}

		// The insert's foreign key would answer a 500.
		const seatedUser = await trx('directus_users')
			.first('id')
			.where('id', user);

		if (seatedUser === undefined) {
			throw new InvalidPayloadError({
				reason: `User ${JSON.stringify(user)} does not exist`,
			});
		}

		const beneficiaryId = await addBeneficiary(trx, { subscription, user });

		// A pending row grants nothing yet: its first sync seats them all.
		if (managedSubscription.provider_subscription_id !== null) {
			const subscriptionProvider = findProvider(
				enabledProviders,
				managedSubscription.provider,
			);

			await enqueueSync(trx, {
				provider: managedSubscription.provider,
				resourceId: subscriptionProvider.composeResourceId({
					subscriptionId: managedSubscription.provider_subscription_id,
					customerId: managedSubscription.provider_customer_id,
				}),
			});
		}

		return beneficiaryId;
	});
}

function readBeneficiaryPayload(
	requestBody: unknown,
): { subscription: number; user: string } {
	const payloadFields = typeof requestBody === 'object' && requestBody !== null
		? requestBody as Record<string, unknown>
		: {};

	const { subscription, user } = payloadFields;

	if (!Number.isSafeInteger(subscription) || (subscription as number) < 1) {
		throw new InvalidPayloadError({
			reason: `"subscription" must be a subscription id, got`
				+ ` ${JSON.stringify(subscription ?? null)}`,
		});
	}

	if (typeof user !== 'string' || !UUID_PATTERN.test(user)) {
		throw new InvalidPayloadError({
			reason: `"user" must be a user id, got ${JSON.stringify(user ?? null)}`,
		});
	}

	return { subscription: subscription as number, user };
}
