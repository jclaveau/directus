import type { AbstractService } from '@directus/types';
import type { Knex } from 'knex';
import { MANAGED_BY_SUBSCRIPTIONS, TERMINAL_STATUSES } from '../constants.js';
import { UnboundProviderSubscriptionError } from '../errors.js';
import {
	recordSubscriptionEvent,
	type SubscriptionEventSource,
} from '../events/record-subscription-event.js';
import type {
	BillingInterval,
	ProviderBilling,
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
	logger: {
		warn: (message: string) => void;
		error: (message: string) => void;
	};
};

export type AccessChange = 'granted' | 'revoked' | 'unchanged';

/**
 * `granted` and `revoked` list the users who gained or lost the plan's access;
 * a policy change grants, but moves no user.
 */
export type SyncedAccess = {
	access: AccessChange;
	granted: string[];
	revoked: string[];
};

/** What a sync left behind, for the `subscriptions.synced` action. */
export type SyncedSubscription = {
	subscription: number;
	status: string;
} & SyncedAccess;

type StoredSubscription = {
	id: number;
	plan: number;
	provider_customer_id: string | null;
	provider_subscription_id: string | null;
	status: string;
	current_period_end: Date | number | string | null;
	cancel_at_period_end: boolean | number;
	custom_amount: number | string | null;
};

type SubscriptionState = {
	provider_customer_id?: string;
	provider_subscription_id?: string;
	status: string;
	current_period_end: Date | number | string | null;
	cancel_at_period_end: boolean;
};

type SubscribedPlan = {
	id: number;
	code: string;
	policy: string;
	status: string;
	amount: number | string;
	currency: string;
	interval: string;
};

const STORED_SUBSCRIPTION_FIELDS = [
	'id',
	'plan',
	'provider_customer_id',
	'provider_subscription_id',
	'status',
	'current_period_end',
	'cancel_at_period_end',
	'custom_amount',
];

/**
 * Writes the provider's state into `subscriptions` and the accesses of its
 * beneficiaries. A sync changing nothing writes nothing, so `date_updated` and
 * `user_updated` keep naming the last real change.
 */
export async function syncSubscription({
	trx,
	accessService,
	subscriptionProvider,
	providerName,
	providerSubscription,
	syncedAt,
	logger,
}: SubscriptionSync): Promise<SyncedSubscription> {
	const storedSubscription = await bindStoredSubscription(
		trx,
		providerName,
		providerSubscription,
		syncedAt,
	);

	const subscribedPlan: SubscribedPlan = await trx('subscription_plans')
		.select('id', 'code', 'policy', 'status', 'amount', 'currency', 'interval')
		.where('id', storedSubscription.plan)
		.first();

	const isFirstSync = storedSubscription.provider_subscription_id === null;

	// The checkout refuses such a plan, but this customer has paid: they get it.
	if (isFirstSync && subscribedPlan.status !== 'active') {
		logger.warn(
			`Subscription ${JSON.stringify(storedSubscription.id)} started on plan`
			+ ` ${JSON.stringify(subscribedPlan.code)}, whose status is`
			+ ` ${JSON.stringify(subscribedPlan.status)}`,
		);
	}

	// A plan changed in the provider's portal: the plan sold stays, an admin
	// settles the difference.
	const soldBilling = readPlanBilling(
		subscribedPlan,
		storedSubscription.custom_amount,
	);

	if (!holdsSoldBilling(soldBilling, providerSubscription.billing)) {
		logger.error(
			`Subscription ${JSON.stringify(storedSubscription.id)} is billed`
			+ ` ${JSON.stringify(providerSubscription.billing)} by`
			+ ` ${JSON.stringify(providerName)}, its plan`
			+ ` ${JSON.stringify(subscribedPlan.code)} sold it at`
			+ ` ${JSON.stringify(soldBilling)}`,
		);
	}

	const managerCount = await countManagers(trx, storedSubscription.id);

	// Nothing to bill once no one manages it. The last manager's account
	// deletion runs no code of ours: the hourly reconcile lands here.
	const isCancelRequested = managerCount === 0
		&& !TERMINAL_STATUSES.includes(providerSubscription.status)
		&& !providerSubscription.cancelAtPeriodEnd;

	if (isCancelRequested) {
		await requestProviderCancel(subscriptionProvider, providerSubscription);
	}

	const accessDecision = decideAccess(providerSubscription, syncedAt, logger);

	const syncedAccess = accessDecision === 'keep'
		? await keepBeneficiaryAccesses({
			trx,
			accessService,
			subscriptionId: storedSubscription.id,
			planPolicy: subscribedPlan.policy,
		})
		: await revokeBeneficiaryAccesses({
			trx,
			accessService,
			subscriptionId: storedSubscription.id,
		});

	await writeSubscriptionState({
		trx,
		storedSubscription,
		subscriptionState: {
			provider_customer_id: providerSubscription.customerId,
			provider_subscription_id: providerSubscription.subscriptionId,
			status: providerSubscription.status,
			current_period_end: providerSubscription.currentPeriodEnd,
			cancel_at_period_end: isCancelRequested
				|| providerSubscription.cancelAtPeriodEnd,
		},
		eventSource: isCancelRequested
			? 'user_deleted'
			: 'sync',
		writtenAt: syncedAt,
	});

	return {
		subscription: storedSubscription.id,
		status: providerSubscription.status,
		...syncedAccess,
	};
}

/**
 * The row a provider's subscription is stored in: found by its provider id,
 * else created carrying on the row it resumes, else the pending row the
 * checkout named in the provider's metadata.
 */
async function bindStoredSubscription(
	trx: Knex,
	providerName: string,
	providerSubscription: ProviderSubscription,
	syncedAt: Date,
): Promise<StoredSubscription> {
	const storedSubscription = await readStoredSubscription(
		trx,
		providerName,
		providerSubscription.subscriptionId,
	);

	if (storedSubscription !== undefined) {
		return storedSubscription;
	}

	if (providerSubscription.resumedSubscriptionId !== undefined) {
		return await createContinuingSubscription({
			trx,
			providerName,
			providerSubscription,
			createdAt: syncedAt,
		});
	}

	const { directusSubscription } = providerSubscription;

	const unboundError = new UnboundProviderSubscriptionError({
		provider: providerName,
		subscriptionId: providerSubscription.subscriptionId,
		directusSubscription,
	});

	if (directusSubscription === null) {
		throw unboundError;
	}

	const pendingQuery = trx('subscriptions')
		.select(STORED_SUBSCRIPTION_FIELDS)
		.where({
			id: directusSubscription,
			provider: providerName,
			provider_subscription_id: null,
		})
		.first();

	if (trx.client.dialect === 'postgresql') {
		pendingQuery.forUpdate();
	}

	const pendingSubscription = await pendingQuery;

	if (pendingSubscription === undefined) {
		throw unboundError;
	}

	return pendingSubscription;
}

type ContinuingSubscriptionCreate = {
	trx: Knex;
	providerName: string;
	providerSubscription: ProviderSubscription;
	createdAt: Date;
};

/**
 * Mollie cannot undo a cancel: a resume is a new subscription, carrying on the
 * chain's last row with its plan, managers and beneficiaries. The beneficiaries
 * share that row's accesses, so none is created twice.
 */
async function createContinuingSubscription({
	trx,
	providerName,
	providerSubscription,
	createdAt,
}: ContinuingSubscriptionCreate): Promise<StoredSubscription> {
	const { resumedSubscriptionId } = providerSubscription;

	const resumedSubscription: ChainRow | undefined = await trx('subscriptions')
		.select('id', 'plan', 'provider_customer_id')
		.where({
			provider: providerName,
			provider_subscription_id: resumedSubscriptionId,
		})
		.first();

	// Created by `POST /subscriptions/resume` after the row it resumes: a retry
	// finds it once that row's own sync stored it.
	if (resumedSubscription === undefined) {
		throw new Error(
			`Subscription ${JSON.stringify(providerSubscription.subscriptionId)}`
			+ ` resumes ${JSON.stringify(resumedSubscriptionId)}, which is not stored`,
		);
	}

	const chainTail = await findChainTail(trx, resumedSubscription);

	await trx('subscriptions').insert({
		plan: chainTail.plan,
		continues: chainTail.id,
		provider: providerName,
		provider_customer_id: chainTail.provider_customer_id,
		provider_subscription_id: null,
		status: 'pending',
		current_period_end: null,
		cancel_at_period_end: false,
		date_created: createdAt,
		date_updated: createdAt,
	});

	const continuingSubscription: StoredSubscription = await trx('subscriptions')
		.select(STORED_SUBSCRIPTION_FIELDS)
		.where('continues', chainTail.id)
		.first();

	const tailManagers = await trx('subscription_managers')
		.select('user')
		.where('subscription', chainTail.id)
		.orderBy('id');

	if (tailManagers.length > 0) {
		await trx('subscription_managers').insert(tailManagers.map((tailManager) => {
			return {
				subscription: continuingSubscription.id,
				user: tailManager.user,
			};
		}));
	}

	const tailBeneficiaries = await trx('subscription_beneficiaries')
		.select('user', 'access')
		.where('subscription', chainTail.id)
		.orderBy('id');

	for (const tailBeneficiary of tailBeneficiaries) {
		// A resume canceled before its first charge gave back its copy of the
		// access an earlier row of the chain still grants.
		const sharedAccess = tailBeneficiary.access === null
			&& tailBeneficiary.user !== null
			? await findChainAccess(trx, chainTail.id, tailBeneficiary.user)
			: tailBeneficiary.access;

		await trx('subscription_beneficiaries').insert({
			subscription: continuingSubscription.id,
			user: tailBeneficiary.user,
			access: sharedAccess,
		});
	}

	return continuingSubscription;
}

type ChainRow = {
	id: number;
	plan: number;
	provider_customer_id: string | null;
};

/** A resume canceled before its first charge leaves the chain one row longer. */
async function findChainTail(trx: Knex, chainRow: ChainRow): Promise<ChainRow> {
	const nextRow: ChainRow | undefined = await trx('subscriptions')
		.select('id', 'plan', 'provider_customer_id')
		.where('continues', chainRow.id)
		.first();

	return nextRow === undefined
		? chainRow
		: await findChainTail(trx, nextRow);
}

async function findChainAccess(
	trx: Knex,
	chainRowId: number,
	beneficiaryUser: string,
): Promise<string | null> {
	const chainBeneficiary = await trx('subscription_beneficiaries')
		.select('access')
		.where({ subscription: chainRowId, user: beneficiaryUser })
		.whereNotNull('access')
		.first();

	if (chainBeneficiary !== undefined) {
		return chainBeneficiary.access;
	}

	const chainRow = await trx('subscriptions')
		.select('continues')
		.where('id', chainRowId)
		.first();

	return chainRow.continues === null
		? null
		: await findChainAccess(trx, chainRow.continues, beneficiaryUser);
}

async function countManagers(
	trx: Knex,
	subscriptionId: number,
): Promise<number> {
	const managerTally = await trx('subscription_managers')
		.count({ managerCount: 'id' })
		.where('subscription', subscriptionId)
		.first();

	return Number(managerTally!.managerCount);
}

function holdsSoldBilling(
	planBilling: ProviderBilling,
	providerBilling: ProviderBilling | null,
): boolean {
	return providerBilling !== null
		&& providerBilling.amountCents === planBilling.amountCents
		&& providerBilling.currency === planBilling.currency
		&& providerBilling.interval.months === planBilling.interval.months
		&& providerBilling.interval.days === planBilling.interval.days;
}

/** A checkout paid above the plan's price bills its `custom_amount`. */
function readPlanBilling(
	subscribedPlan: SubscribedPlan,
	customAmount: number | string | null,
): ProviderBilling {
	return {
		// A decimal column: Postgres hands back "10.00", SQLite 10.
		amountCents: Math.round(Number(customAmount ?? subscribedPlan.amount) * 100),
		currency: subscribedPlan.currency.toUpperCase(),
		interval: readPlanInterval(subscribedPlan),
	};
}

export function readPlanInterval(
	subscribedPlan: Pick<SubscribedPlan, 'code' | 'interval'>,
): BillingInterval {
	const planDuration: Record<string, unknown> = JSON.parse(
		subscribedPlan.interval,
	);

	const readDurationPart = (durationUnit: string): number => {
		const durationValue = planDuration[durationUnit] ?? 0;

		if (typeof durationValue !== 'number') {
			throw new Error(
				`Plan ${JSON.stringify(subscribedPlan.code)} has interval`
				+ ` ${JSON.stringify(subscribedPlan.interval)}, whose`
				+ ` ${JSON.stringify(durationUnit)} is not a number`,
			);
		}

		return durationValue;
	};

	return {
		months: readDurationPart('years') * 12 + readDurationPart('months'),
		days: readDurationPart('weeks') * 7 + readDurationPart('days'),
	};
}

/**
 * Inside the sync's transaction, holding the row lock through the call: after a
 * rollback the retry finds the provider already cancelling and records `sync`.
 * A stored cancel the provider no longer holds cancels again with no event.
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
}: MissingSubscriptionClose): Promise<SyncedSubscription | undefined> {
	const storedSubscription = subscriptionId === null
		? undefined
		: await readStoredSubscription(trx, providerName, subscriptionId);

	if (storedSubscription === undefined) {
		return undefined;
	}

	const syncedAccess = await revokeBeneficiaryAccesses({
		trx,
		accessService,
		subscriptionId: storedSubscription.id,
	});

	await writeSubscriptionState({
		trx,
		storedSubscription,
		subscriptionState: {
			status: 'canceled',
			current_period_end: storedSubscription.current_period_end,
			cancel_at_period_end: Boolean(storedSubscription.cancel_at_period_end),
		},
		eventSource: 'provider_missing',
		writtenAt: closedAt,
	});

	return {
		subscription: storedSubscription.id,
		status: 'canceled',
		...syncedAccess,
	};
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
		.select(STORED_SUBSCRIPTION_FIELDS)
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

type BeneficiaryAccessKeeping = {
	trx: Knex;
	accessService: AbstractService;
	subscriptionId: number;
	planPolicy: string;
};

/**
 * A beneficiary whose account was deleted has no user left to grant. Linking
 * the access a resumed chain already grants changes no one's access.
 */
async function keepBeneficiaryAccesses({
	trx,
	accessService,
	subscriptionId,
	planPolicy,
}: BeneficiaryAccessKeeping): Promise<SyncedAccess> {
	const syncedAccess: SyncedAccess = {
		access: 'unchanged',
		granted: [],
		revoked: [],
	};

	const grantedBeneficiaries = await trx('subscription_beneficiaries')
		.select('id', 'user', 'access')
		.where('subscription', subscriptionId)
		.whereNotNull('user')
		.orderBy('id');

	for (const grantedBeneficiary of grantedBeneficiaries) {
		// A pending resume gave back its link to the access the chain grants.
		const chainAccess = grantedBeneficiary.access === null
			? await findChainAccess(trx, subscriptionId, grantedBeneficiary.user)
			: null;

		if (chainAccess !== null) {
			await trx('subscription_beneficiaries')
				.where('id', grantedBeneficiary.id)
				.update({ access: chainAccess });

			grantedBeneficiary.access = chainAccess;
		}

		if (grantedBeneficiary.access === null) {
			const createdAccess = await accessService.createOne({
				user: grantedBeneficiary.user,
				policy: planPolicy,
				managed_by: MANAGED_BY_SUBSCRIPTIONS,
			});

			await trx('subscription_beneficiaries')
				.where('id', grantedBeneficiary.id)
				.update({ access: String(createdAccess) });

			syncedAccess.access = 'granted';
			syncedAccess.granted.push(grantedBeneficiary.user);

			continue;
		}

		const accessRow = await trx('directus_access')
			.select('user', 'policy')
			.where('id', grantedBeneficiary.access)
			.first();

		if (accessRow.user !== grantedBeneficiary.user
			|| accessRow.policy !== planPolicy) {
			// Moved, not replaced: a resumed subscription shares this row.
			await accessService.updateOne(grantedBeneficiary.access, {
				user: grantedBeneficiary.user,
				policy: planPolicy,
			});

			syncedAccess.access = 'granted';

			if (accessRow.user !== grantedBeneficiary.user) {
				syncedAccess.granted.push(grantedBeneficiary.user);
				syncedAccess.revoked.push(accessRow.user);
			}
		}
	}

	return syncedAccess;
}

type BeneficiaryAccessRevoke = {
	trx: Knex;
	accessService: AbstractService;
	subscriptionId: number;
};

/** An access a resume still shares stays: the other row keeps granting it. */
async function revokeBeneficiaryAccesses({
	trx,
	accessService,
	subscriptionId,
}: BeneficiaryAccessRevoke): Promise<SyncedAccess> {
	const grantingBeneficiaries = await trx('subscription_beneficiaries')
		.select('id', 'user', 'access')
		.where('subscription', subscriptionId)
		.whereNotNull('access')
		.orderBy('id');

	const syncedAccess: SyncedAccess = {
		access: 'unchanged',
		granted: [],
		revoked: [],
	};

	for (const grantingBeneficiary of grantingBeneficiaries) {
		await trx('subscription_beneficiaries')
			.where('id', grantingBeneficiary.id)
			.update({ access: null });

		const sharingBeneficiary = await trx('subscription_beneficiaries')
			.first('id')
			.where('access', grantingBeneficiary.access);

		if (sharingBeneficiary === undefined) {
			await accessService.deleteOne(grantingBeneficiary.access);

			syncedAccess.access = 'revoked';

			// A deleted account took its access row with it: no one loses it now.
			if (grantingBeneficiary.user !== null) {
				syncedAccess.revoked.push(grantingBeneficiary.user);
			}
		}
	}

	return syncedAccess;
}
