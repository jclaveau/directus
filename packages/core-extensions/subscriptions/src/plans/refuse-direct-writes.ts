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

/** Archiving ends subscriptions, which only the archive endpoint does. */
export function refusePlanArchiveByUpdate(
	updateEntries: UpdateEntries,
): UpdateEntries {
	const isArchiving = updateEntries.some((updateEntry) => {
		return 'data' in updateEntry && updateEntry.data['status'] === 'archived';
	});

	if (isArchiving) {
		throw new InvalidPayloadError({
			reason: 'A plan is archived through'
				+ ' "POST /subscriptions/plans/:id/archive"',
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
