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

/**
 * A subscription points at the reference it was sold under, which says what the
 * provider bills: the row would otherwise claim another product. An unused one
 * stays editable, for a typo.
 */
export async function refuseUsedReferenceUpdate(
	updateEntries: UpdateEntries,
	database: Knex,
): Promise<UpdateEntries> {
	const usedReference = await database('subscriptions')
		.join(
			'subscription_plan_references',
			'subscription_plan_references.id',
			'subscriptions.plan_reference',
		)
		.select('subscription_plan_references.reference')
		.whereIn(
			'subscriptions.plan_reference',
			listUpdatedKeys(updateEntries, ['plan', 'provider', 'reference']),
		)
		.first();

	if (usedReference !== undefined) {
		throw new InvalidPayloadError({
			reason: `Plan reference ${JSON.stringify(usedReference.reference)} is`
				+ ' used by a subscription, it cannot change',
		});
	}

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
