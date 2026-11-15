import { InvalidPayloadError } from '@directus/errors';
import type { Knex } from 'knex';

export type PendingSubscriptionCreate = {
	plan: number;
	provider: string;
};

/**
 * The row a checkout names in the provider's metadata as
 * `directus_subscription`: its first sync binds the provider's ids to it. The
 * caller adds its managers and beneficiaries.
 */
export async function createPendingSubscription(
	trx: Knex,
	{ plan, provider }: PendingSubscriptionCreate,
): Promise<number> {
	const soldPlan = await trx('subscription_plans')
		.select('code', 'status')
		.where('id', plan)
		.first();

	if (soldPlan === undefined) {
		throw new InvalidPayloadError({
			reason: `Plan ${JSON.stringify(plan)} does not exist`,
		});
	}

	if (soldPlan.status !== 'active') {
		throw new InvalidPayloadError({
			reason: `Plan ${JSON.stringify(soldPlan.code)} is`
				+ ` ${JSON.stringify(soldPlan.status)}, it sells no new subscription`,
		});
	}

	const createdAt = new Date();

	const [insertedRow] = await trx('subscriptions').insert(
		{
			plan,
			provider,
			status: 'pending',
			cancel_at_period_end: false,
			date_created: createdAt,
			date_updated: createdAt,
		},
		['id'],
	);

	return readInsertedId(insertedRow);
}

/** MariaDB has no RETURNING: knex hands back the bare insert id there. */
export function readInsertedId(insertedRow: { id: number } | number): number {
	return typeof insertedRow === 'object'
		? insertedRow.id
		: insertedRow;
}
