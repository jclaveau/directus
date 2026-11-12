import type { AbstractService } from '@directus/types';
import type { Knex } from 'knex';
import { MANAGED_BY_SUBSCRIPTIONS, TERMINAL_STATUSES } from '../constants.js';
import {
	recordSubscriptionEvent,
	type SubscriptionEventSource,
} from '../events/record-subscription-event.js';
import type {
	ProviderSubscription,
	SubscriptionProvider,
} from '../providers/types.js';
import { decideAccess } from './decide-access.js';

export type SubscriptionSync = {
	trx: Knex;
	accessService: AbstractService;
	subscriptionProvider: SubscriptionProvider;
	providerName: string;
	providerSubscription: ProviderSubscription;
	syncedAt: Date;
	logger: { warn: (message: string) => void };
};

type StoredSubscription = {
	id: number;
	subscriber: number;
	customer: number;
	plan_reference: number;
	status: string;
	current_period_end: Date | number | string | null;
	cancel_at_period_end: boolean | number;
	access: string | null;
};

type SubscriptionState = {
	subscriber?: number;
	customer?: number;
	plan_reference?: number;
	status: string;
	current_period_end: Date | number | string | null;
	cancel_at_period_end: boolean;
	access: string | null;
};

/**
 * Writes the provider's state into `subscriptions` and its access row. A sync
 * changing nothing writes nothing, so `date_updated` and `user_updated` keep
 * naming the last real change.
 */
export async function syncSubscription({
	trx,
	accessService,
	subscriptionProvider,
	providerName,
	providerSubscription,
	syncedAt,
	logger,
}: SubscriptionSync): Promise<void> {
	const storedSubscription = await readStoredSubscription(
		trx,
		providerName,
		providerSubscription.subscriptionId,
	);

	const storedAccess = storedSubscription?.access ?? null;
	const accessDecision = decideAccess(providerSubscription, syncedAt, logger);

	const providerState = {
		status: providerSubscription.status,
		current_period_end: providerSubscription.currentPeriodEnd,
		cancel_at_period_end: providerSubscription.cancelAtPeriodEnd,
	};

	// Revoking needs the stored row alone: a plan reference removed since, or a
	// customer gone, must not keep a paid product granted.
	if (accessDecision === 'revoke' && storedSubscription !== undefined) {
		const storedSubscriber = await trx('subscribers')
			.select('user')
			.where('id', storedSubscription.subscriber)
			.first();

		// `unpaid` or `suspended` can still charge again once paid.
		const isCancelRequested = storedSubscriber.user === null
			&& !TERMINAL_STATUSES.includes(providerSubscription.status)
			&& !providerSubscription.cancelAtPeriodEnd;

		if (isCancelRequested) {
			await requestProviderCancel(subscriptionProvider, providerSubscription);
		}

		await writeSubscriptionState({
			trx,
			storedSubscription,
			subscriptionState: {
				...providerState,
				cancel_at_period_end: isCancelRequested
					|| providerState.cancel_at_period_end,
				access: await revokeAccess(accessService, storedAccess),
			},
			eventSource: isCancelRequested
				? 'user_deleted'
				: 'sync',
			writtenAt: syncedAt,
		});

		return;
	}

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
		.select(
			'subscription_plan_references.id as reference_id',
			'subscription_plans.id',
			'subscription_plans.policy',
			'subscription_plans.status',
		)
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

	// The checkout refuses such a plan, but this customer has paid: they get it.
	if (storedSubscription === undefined && subscribedPlan.status !== 'active') {
		logger.warn(
			`Subscription ${JSON.stringify(providerSubscription.subscriptionId)}`
			+ ` started on plan ${JSON.stringify(subscribedPlan.id)}, whose status`
			+ ` is ${JSON.stringify(subscribedPlan.status)}`,
		);
	}

	const subscriber = await trx('subscribers')
		.select('user')
		.where('id', subscriberCustomer.subscriber)
		.first();

	const isKept = accessDecision === 'keep';
	const isUserDeleted = isKept && subscriber.user === null;

	// Nothing to bill a deleted user for. The deletion itself runs no code of
	// ours, whatever deleted the row: the hourly reconcile lands here.
	const isCancelRequested = isUserDeleted
		&& !providerSubscription.cancelAtPeriodEnd;

	if (isCancelRequested) {
		await requestProviderCancel(subscriptionProvider, providerSubscription);
	}

	const grantedAccess = isKept && !isUserDeleted
		? await keepAccess({
			trx,
			accessService,
			storedAccess,
			grantedUser: subscriber.user,
			planPolicy: subscribedPlan.policy,
		})
		: await revokeAccess(accessService, storedAccess);

	const subscriptionState: SubscriptionState = {
		...providerState,
		subscriber: subscriberCustomer.subscriber,
		customer: subscriberCustomer.id,
		plan_reference: subscribedPlan.reference_id,
		cancel_at_period_end: isUserDeleted || providerState.cancel_at_period_end,
		access: grantedAccess,
	};

	const eventSource = isCancelRequested
		? 'user_deleted'
		: 'sync';

	if (storedSubscription !== undefined) {
		await writeSubscriptionState({
			trx,
			storedSubscription,
			subscriptionState,
			eventSource,
			writtenAt: syncedAt,
		});

		return;
	}

	await trx('subscriptions').insert({
		...subscriptionState,
		resumes: await readResumedRowId(trx, providerName, providerSubscription),
		provider: providerName,
		provider_subscription_id: providerSubscription.subscriptionId,
		date_created: syncedAt,
		date_updated: syncedAt,
	});

	const insertedSubscription = await readStoredSubscription(
		trx,
		providerName,
		providerSubscription.subscriptionId,
	);

	await recordSubscriptionEvent(trx, {
		subscriptionId: insertedSubscription!.id,
		status: providerState.status,
		currentPeriodEnd: providerState.current_period_end,
		cancelAtPeriodEnd: subscriptionState.cancel_at_period_end,
		source: eventSource,
		userId: null,
		recordedAt: syncedAt,
	});
}

/** A resume is created by `POST /subscriptions/resume`, after the row it resumes. */
async function readResumedRowId(
	trx: Knex,
	providerName: string,
	providerSubscription: ProviderSubscription,
): Promise<number | null> {
	const { resumedSubscriptionId } = providerSubscription;

	if (resumedSubscriptionId === undefined) {
		return null;
	}

	const resumedSubscription = await trx('subscriptions')
		.select('id')
		.where({
			provider: providerName,
			provider_subscription_id: resumedSubscriptionId,
		})
		.first();

	if (resumedSubscription === undefined) {
		throw new Error(
			`Subscription ${JSON.stringify(providerSubscription.subscriptionId)}`
			+ ` resumes ${JSON.stringify(resumedSubscriptionId)}, which is not stored`,
		);
	}

	return resumedSubscription.id;
}

/**
 * Outside the transaction: after a rollback the retry finds the provider already
 * cancelling and records `sync`. A stored cancel the provider no longer holds
 * cancels again with no event.
 */
async function requestProviderCancel(
	subscriptionProvider: SubscriptionProvider,
	providerSubscription: ProviderSubscription,
): Promise<void> {
	await subscriptionProvider.cancelAtPeriodEnd(
		subscriptionProvider.composeResourceId({
			subscriptionId: providerSubscription.subscriptionId,
			customerId: providerSubscription.customerId,
		}),
	);
}

export type MissingSubscriptionClose = {
	trx: Knex;
	accessService: AbstractService;
	providerName: string;
	subscriptionId: string | null;
	closedAt: Date;
};

/**
 * A provider's 404 will not heal, so no retry: the row stays, billing history
 * outlives the subscription, and only stops granting.
 */
export async function closeMissingSubscription({
	trx,
	accessService,
	providerName,
	subscriptionId,
	closedAt,
}: MissingSubscriptionClose): Promise<void> {
	const storedSubscription = subscriptionId === null
		? undefined
		: await readStoredSubscription(trx, providerName, subscriptionId);

	if (storedSubscription === undefined) {
		return;
	}

	await writeSubscriptionState({
		trx,
		storedSubscription,
		subscriptionState: {
			status: 'canceled',
			current_period_end: storedSubscription.current_period_end,
			cancel_at_period_end: Boolean(storedSubscription.cancel_at_period_end),
			access: await revokeAccess(accessService, storedSubscription.access),
		},
		eventSource: 'provider_missing',
		writtenAt: closedAt,
	});
}

async function readStoredSubscription(
	trx: Knex,
	providerName: string,
	subscriptionId: string,
): Promise<StoredSubscription | undefined> {
	return await selectStoredSubscription(trx, providerName, subscriptionId);
}

export function selectStoredSubscription(
	trx: Knex,
	providerName: string,
	subscriptionId: string,
) {
	const storedQuery = trx('subscriptions')
		.select(
			'id',
			'subscriber',
			'customer',
			'plan_reference',
			'status',
			'current_period_end',
			'cancel_at_period_end',
			'access',
		)
		.where({
			provider: providerName,
			provider_subscription_id: subscriptionId,
		})
		.first();

	// Two queue rows can name one subscription (Mollie's tr_ and cst/sub), and
	// overlapping batches would each create an access.
	if (trx.client.dialect === 'postgresql') {
		storedQuery.forUpdate();
	}

	return storedQuery;
}

type SubscriptionStateWrite = {
	trx: Knex;
	storedSubscription: StoredSubscription;
	subscriptionState: SubscriptionState;
	eventSource: SubscriptionEventSource;
	writtenAt: Date;
};

async function writeSubscriptionState({
	trx,
	storedSubscription,
	subscriptionState,
	eventSource,
	writtenAt,
}: SubscriptionStateWrite): Promise<void> {
	if (holdsSubscriptionState(storedSubscription, subscriptionState)) {
		return;
	}

	await trx('subscriptions')
		.where('id', storedSubscription.id)
		.update({
			...subscriptionState,
			date_updated: writtenAt,
			user_updated: null,
		});

	await recordSubscriptionEvent(trx, {
		subscriptionId: storedSubscription.id,
		status: subscriptionState.status,
		currentPeriodEnd: subscriptionState.current_period_end,
		cancelAtPeriodEnd: subscriptionState.cancel_at_period_end,
		source: eventSource,
		userId: null,
		recordedAt: writtenAt,
	});
}

function holdsSubscriptionState(
	storedSubscription: StoredSubscription,
	subscriptionState: SubscriptionState,
): boolean {
	return Object.entries(subscriptionState).every(([fieldName, fieldValue]) => {
		const storedValue = storedSubscription[
			fieldName as keyof StoredSubscription
		];

		// The database hands a date and a boolean back in its own type.
		if (fieldName === 'current_period_end') {
			return readPeriodTime(storedValue) === readPeriodTime(fieldValue);
		}

		if (fieldName === 'cancel_at_period_end') {
			return Boolean(storedValue) === fieldValue;
		}

		return storedValue === fieldValue;
	});
}

function readPeriodTime(periodEnd: unknown): number | null {
	return periodEnd === null
		? null
		: new Date(periodEnd as Date | number | string).getTime();
}

type AccessKeeping = {
	trx: Knex;
	accessService: AbstractService;
	storedAccess: string | null;
	grantedUser: string;
	planPolicy: string;
};

async function keepAccess({
	trx,
	accessService,
	storedAccess,
	grantedUser,
	planPolicy,
}: AccessKeeping): Promise<string> {
	if (storedAccess !== null) {
		const accessRow = await trx('directus_access')
			.select('user', 'policy')
			.where('id', storedAccess)
			.first();

		if (accessRow.user === grantedUser
			&& accessRow.policy === planPolicy) {
			return storedAccess;
		}

		await accessService.deleteOne(storedAccess);
	}

	const createdAccess = await accessService.createOne({
		user: grantedUser,
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
