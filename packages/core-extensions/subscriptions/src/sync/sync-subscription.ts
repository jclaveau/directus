import type { AbstractService } from '@directus/types';
import type { Knex } from 'knex';
import { MANAGED_BY_SUBSCRIPTIONS } from '../constants.js';
import type { ProviderSubscription } from '../providers/types.js';
import { decideAccess } from './decide-access.js';

export type SubscriptionSync = {
	trx: Knex;
	accessService: AbstractService;
	providerName: string;
	providerSubscription: ProviderSubscription;
	syncedAt: Date;
};

/** Writes the provider's state into `subscriptions` and its access row. */
export async function syncSubscription({
	trx,
	accessService,
	providerName,
	providerSubscription,
	syncedAt,
}: SubscriptionSync): Promise<void> {
	const subscriberCustomer = await trx('subscriber_customers')
		.select('id', 'subscriber')
		.where({
			provider: providerName,
			provider_customer_id: providerSubscription.customerId,
		})
		.first();

	if (subscriberCustomer === undefined) {
		throw new Error(
			`No subscriber has ${JSON.stringify(providerName)} customer`
			+ ` ${JSON.stringify(providerSubscription.customerId)}`,
		);
	}

	const subscribedPlan = await trx('subscription_plan_references')
		.join(
			'subscription_plans',
			'subscription_plans.id',
			'subscription_plan_references.plan',
		)
		.select('subscription_plans.id', 'subscription_plans.policy')
		.where({
			'subscription_plan_references.provider': providerName,
			'subscription_plan_references.reference':
				providerSubscription.planReference,
		})
		.first();

	if (subscribedPlan === undefined) {
		throw new Error(
			`No plan has ${JSON.stringify(providerName)} reference`
			+ ` ${JSON.stringify(providerSubscription.planReference)}`,
		);
	}

	const storedSubscription = await trx('subscriptions')
		.select('id', 'access')
		.where({
			provider: providerName,
			provider_subscription_id: providerSubscription.subscriptionId,
		})
		.first();

	const storedAccess: string | null = storedSubscription?.access ?? null;

	const grantedAccess = decideAccess(providerSubscription, syncedAt) === 'keep'
		? await keepAccess({
			trx,
			accessService,
			storedAccess,
			subscriberId: subscriberCustomer.subscriber,
			planPolicy: subscribedPlan.policy,
		})
		: await revokeAccess(accessService, storedAccess);

	const subscriptionFields = {
		subscriber: subscriberCustomer.subscriber,
		customer: subscriberCustomer.id,
		plan: subscribedPlan.id,
		status: providerSubscription.status,
		current_period_end: providerSubscription.currentPeriodEnd,
		cancel_at_period_end: providerSubscription.cancelAtPeriodEnd,
		access: grantedAccess,
		date_updated: syncedAt,
	};

	if (storedSubscription === undefined) {
		await trx('subscriptions').insert({
			...subscriptionFields,
			provider: providerName,
			provider_subscription_id: providerSubscription.subscriptionId,
			date_created: syncedAt,
		});

		return;
	}

	await trx('subscriptions')
		.where('id', storedSubscription.id)
		.update(subscriptionFields);
}

type AccessKeeping = {
	trx: Knex;
	accessService: AbstractService;
	storedAccess: string | null;
	subscriberId: number;
	planPolicy: string;
};

async function keepAccess({
	trx,
	accessService,
	storedAccess,
	subscriberId,
	planPolicy,
}: AccessKeeping): Promise<string> {
	const subscriber = await trx('subscribers')
		.select('user')
		.where('id', subscriberId)
		.first();

	if (subscriber.user === null) {
		throw new Error(
			`Subscriber ${JSON.stringify(subscriberId)} has no user to grant`
			+ ' access to',
		);
	}

	if (storedAccess !== null) {
		const accessRow = await trx('directus_access')
			.select('user', 'policy')
			.where('id', storedAccess)
			.first();

		if (accessRow.user === subscriber.user
			&& accessRow.policy === planPolicy) {
			return storedAccess;
		}

		await accessService.deleteOne(storedAccess);
	}

	const createdAccess = await accessService.createOne({
		user: subscriber.user,
		policy: planPolicy,
		managed_by: MANAGED_BY_SUBSCRIPTIONS,
	});

	return String(createdAccess);
}

async function revokeAccess(
	accessService: AbstractService,
	storedAccess: string | null,
): Promise<null> {
	if (storedAccess !== null) {
		await accessService.deleteOne(storedAccess);
	}

	return null;
}
