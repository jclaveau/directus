import { InvalidPayloadError } from '@directus/errors';
import type { PrimaryKey, UpdateEntries } from '@directus/types';
import type { Knex } from 'knex';

/** Subscriptions and their history reference a plan: it can only be archived. */
export async function refusePlanDelete(
	planKeys: PrimaryKey[],
	database: Knex,
): Promise<PrimaryKey[]> {
	const deletedPlan = await database('subscription_plans')
		.select('code')
		.whereIn('id', planKeys)
		.first();

	if (deletedPlan !== undefined) {
		throw new InvalidPayloadError({
			reason: `Plan ${JSON.stringify(deletedPlan.code)} cannot be deleted,`
				+ ' archive it instead',
		});
	}

	return planKeys;
}

/**
 * Archiving ends subscriptions, which only the archive endpoint does, and those
 * stay ended: reopening the plan would not bring them back.
 */
export async function refusePlanStatusUpdate(
	updateEntries: UpdateEntries,
	database: Knex,
): Promise<UpdateEntries> {
	const isArchiving = updateEntries.some((updateEntry) => {
		return 'data' in updateEntry && updateEntry.data['status'] === 'archived';
	});

	if (isArchiving) {
		throw new InvalidPayloadError({
			reason: 'A plan is archived through'
				+ ' "POST /subscriptions/plans/:id/archive"',
		});
	}

	const archivedPlan = await database('subscription_plans')
		.select('code')
		.whereIn('id', listUpdatedKeys(updateEntries, ['status']))
		.where('status', 'archived')
		.first();

	if (archivedPlan !== undefined) {
		throw new InvalidPayloadError({
			reason: `Plan ${JSON.stringify(archivedPlan.code)} is archived,`
				+ ' its status cannot change',
		});
	}

	return updateEntries;
}

const FROZEN_PLAN_FIELDS = [
	'amount',
	'currency',
	'interval',
	'beneficiaries_max',
] as const;

/**
 * What the provider bills and how many seats were sold: a subscription keeps
 * the plan it was sold under, so a new price is a new plan. An unused plan
 * stays editable, for a typo. A subscription created between this read and the
 * update is not seen: the plan is then edited under it.
 */
export async function refuseFrozenPlanUpdate(
	updateEntries: UpdateEntries,
	database: Knex,
): Promise<UpdateEntries> {
	for (const updateEntry of updateEntries) {
		if (!('data' in updateEntry)) {
			continue;
		}

		const frozenFields = FROZEN_PLAN_FIELDS.filter((fieldName) => {
			return fieldName in updateEntry.data;
		});

		if (frozenFields.length === 0) {
			continue;
		}

		const subscribedPlans = await database('subscription_plans')
			.select('code', ...frozenFields)
			.whereIn('id', updateEntry.keys)
			.whereExists(
				database('subscriptions')
					.select('subscriptions.id')
					.whereColumn('subscriptions.plan', 'subscription_plans.id'),
			)
			.orderBy('id');

		for (const subscribedPlan of subscribedPlans) {
			const isChanging = frozenFields.some((fieldName) => {
				return readFrozenValue(fieldName, subscribedPlan[fieldName])
					!== readFrozenValue(fieldName, updateEntry.data[fieldName]);
			});

			if (isChanging) {
				throw new InvalidPayloadError({
					reason: `Plan ${JSON.stringify(subscribedPlan.code)} has`
						+ ' subscriptions: create a new plan to change its amount,'
						+ ' currency, interval or beneficiaries_max',
				});
			}
		}
	}

	return updateEntries;
}

/** The database hands a decimal back as "10.00" and a JSON column as text. */
function readFrozenValue(
	fieldName: typeof FROZEN_PLAN_FIELDS[number],
	fieldValue: unknown,
): string {
	if (fieldName === 'amount' || fieldName === 'beneficiaries_max') {
		return String(Number(fieldValue));
	}

	if (fieldName === 'interval') {
		return readIntervalParts(fieldValue);
	}

	return String(fieldValue);
}

/** An interval no JSON parse reads compares unequal: the plan refuses it. */
function readIntervalParts(intervalValue: unknown): string {
	let intervalParts: unknown = intervalValue;

	if (typeof intervalValue === 'string') {
		try {
			intervalParts = JSON.parse(intervalValue);
		}
		catch {
			return `unparsable ${intervalValue}`;
		}
	}

	if (typeof intervalParts !== 'object' || intervalParts === null) {
		return JSON.stringify(intervalParts);
	}

	return JSON.stringify(Object.fromEntries(
		Object.entries(intervalParts).sort(([leftPart], [rightPart]) => {
			return leftPart.localeCompare(rightPart);
		}),
	));
}

/**
 * A user delete cascades instead: its sync cancels at period end. A plain read,
 * no lock: two managers removing each other at once both pass.
 */
export async function refuseLastManagerRemoval(
	removedKeys: PrimaryKey[],
	database: Knex,
): Promise<void> {
	if (removedKeys.length === 0) {
		return;
	}

	const orphanedSubscription = await database('subscription_managers')
		.distinct('subscription')
		.whereIn('id', removedKeys)
		.whereNotExists(
			database('subscription_managers as staying_managers')
				.select('staying_managers.id')
				.whereColumn(
					'staying_managers.subscription',
					'subscription_managers.subscription',
				)
				.whereNotIn('staying_managers.id', removedKeys),
		)
		.orderBy('subscription')
		.first();

	if (orphanedSubscription !== undefined) {
		throw new InvalidPayloadError({
			reason: `Subscription ${JSON.stringify(orphanedSubscription.subscription)}`
				+ ' needs at least 1 manager',
		});
	}
}

export async function refuseLastManagerDelete(
	managerKeys: PrimaryKey[],
	database: Knex,
): Promise<PrimaryKey[]> {
	await refuseLastManagerRemoval(managerKeys, database);

	return managerKeys;
}

/** Moving a manager to another subscription removes them from theirs. */
export async function refuseLastManagerMove(
	updateEntries: UpdateEntries,
	database: Knex,
): Promise<UpdateEntries> {
	const movedKeys: PrimaryKey[] = [];

	for (const updateEntry of updateEntries) {
		if (!('data' in updateEntry) || !('subscription' in updateEntry.data)) {
			continue;
		}

		const leavingManagers = await database('subscription_managers')
			.pluck('id')
			.whereIn('id', updateEntry.keys)
			.whereNot('subscription', Number(updateEntry.data['subscription']));

		movedKeys.push(...leavingManagers);
	}

	await refuseLastManagerRemoval(movedKeys, database);

	return updateEntries;
}

/**
 * The next sync would overwrite these with what the provider holds.
 *
 * To investigate: the admin could become the control panel of Stripe and Mollie
 * (or another provider) at once, these writes then calling the provider instead
 * of being refused.
 */
export function refuseSubscriptionStateUpdate(
	updateEntries: UpdateEntries,
): UpdateEntries {
	const isChangingState = updateEntries.some((updateEntry) => {
		return 'data' in updateEntry
			&& ('status' in updateEntry.data
				|| 'cancel_at_period_end' in updateEntry.data);
	});

	if (isChangingState) {
		throw new InvalidPayloadError({
			reason: '"status" and "cancel_at_period_end" of a subscription follow'
				+ ' its provider',
		});
	}

	// What the provider bills and which subscription it resumes, both set when
	// the row is created.
	const isChangingOrigin = updateEntries.some((updateEntry) => {
		return 'data' in updateEntry
			&& ('plan' in updateEntry.data || 'continues' in updateEntry.data);
	});

	if (isChangingOrigin) {
		throw new InvalidPayloadError({
			reason: '"plan" and "continues" of a subscription follow its provider',
		});
	}

	return updateEntries;
}

/**
 * A moved beneficiary would keep its old access until the next sync, while a
 * delete revokes it in its own transaction and an add grants the new one. A
 * write of the stored value, as a client sending the whole row back, passes.
 */
export async function refuseBeneficiaryMove(
	updateEntries: UpdateEntries,
	database: Knex,
): Promise<UpdateEntries> {
	for (const updateEntry of updateEntries) {
		if (!('data' in updateEntry)) {
			continue;
		}

		for (const movedColumn of ['user', 'subscription']) {
			if (!(movedColumn in updateEntry.data)) {
				continue;
			}

			const writtenValue = updateEntry.data[movedColumn];

			const movedBeneficiary = await database('subscription_beneficiaries')
				.select('id')
				.whereIn('id', updateEntry.keys)
				.where((changedQuery) => {
					if (writtenValue === null) {
						changedQuery.whereNotNull(movedColumn);
					}
					else {
						changedQuery.whereNot(movedColumn, writtenValue)
							.orWhereNull(movedColumn);
					}
				})
				.first();

			if (movedBeneficiary !== undefined) {
				throw new InvalidPayloadError({
					reason: `A beneficiary's ${JSON.stringify(movedColumn)} cannot`
						+ ' change: delete the beneficiary and add the new one',
				});
			}
		}
	}

	return updateEntries;
}

/** The bundle writes this history itself, under the sync's transaction. */
export function refuseSubscriptionEventWrite(): never {
	throw new InvalidPayloadError({
		reason: '"subscription_events" only records what the subscriptions'
			+ ' bundle did',
	});
}

function listUpdatedKeys(
	updateEntries: UpdateEntries,
	fieldNames: string[],
): PrimaryKey[] {
	return updateEntries.flatMap((updateEntry) => {
		const isUpdatingField = 'data' in updateEntry
			&& fieldNames.some((fieldName) => {
				return fieldName in updateEntry.data;
			});

		return isUpdatingField
			? updateEntry.keys
			: [];
	});
}
