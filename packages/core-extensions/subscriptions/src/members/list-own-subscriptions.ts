import { ForbiddenError } from '@directus/errors';
import type { Knex } from 'knex';

type SubscriptionRole = 'manager' | 'beneficiary';

export type OwnSubscription = {
	id: number;
	plan: { code: string; name: string };
	provider: string;
	status: string;
	current_period_end: string | null;
	cancel_at_period_end: boolean;
	roles: SubscriptionRole[];
	amount?: string;
	currency?: string;
	beneficiaries?: string[];
};

// Never paid: a checkout left open, or one its provider let expire.
const UNPAID_STATUSES = ['pending', 'expired'];

/**
 * `GET /subscriptions/mine`: what the user manages or is seated on, newest
 * first. Only a manager sees the price and who is seated.
 */
export async function listOwnSubscriptions(
	database: Knex,
	userId: string | null,
): Promise<OwnSubscription[]> {
	if (userId === null) {
		throw new ForbiddenError();
	}

	const managedIds = new Set(await database('subscription_managers')
		.where('user', userId)
		.pluck('subscription'));

	const seatedIds = new Set(await database('subscription_beneficiaries')
		.where('user', userId)
		.pluck('subscription'));

	const ownRows = await database('subscriptions')
		.join('subscription_plans', 'subscription_plans.id', 'subscriptions.plan')
		.select(
			'subscriptions.id',
			'subscriptions.provider',
			'subscriptions.status',
			'subscriptions.current_period_end',
			'subscriptions.cancel_at_period_end',
			'subscriptions.custom_amount',
			'subscription_plans.code',
			'subscription_plans.name',
			'subscription_plans.amount',
			'subscription_plans.currency',
		)
		.whereIn('subscriptions.id', [...managedIds, ...seatedIds])
		.whereNotIn('subscriptions.status', UNPAID_STATUSES)
		.orderBy('subscriptions.id', 'desc');

	const seatRows: { subscription: number; email: string }[] = await database(
		'subscription_beneficiaries',
	)
		.join(
			'directus_users',
			'directus_users.id',
			'subscription_beneficiaries.user',
		)
		.select('subscription_beneficiaries.subscription', 'directus_users.email')
		.whereIn('subscription_beneficiaries.subscription', [...managedIds]);

	return ownRows.map((ownRow): OwnSubscription => {
		const ownSubscription: OwnSubscription = {
			id: ownRow.id,
			plan: { code: ownRow.code, name: ownRow.name },
			provider: ownRow.provider,
			status: ownRow.status,
			current_period_end: ownRow.current_period_end === null
				? null
				: new Date(ownRow.current_period_end).toISOString(),
			cancel_at_period_end: Boolean(ownRow.cancel_at_period_end),
			roles: [
				...managedIds.has(ownRow.id)
					? ['manager' as const]
					: [],
				...seatedIds.has(ownRow.id)
					? ['beneficiary' as const]
					: [],
			],
		};

		if (!managedIds.has(ownRow.id)) {
			return ownSubscription;
		}

		return {
			...ownSubscription,
			amount: Number(ownRow.custom_amount ?? ownRow.amount)
				.toFixed(2),
			currency: ownRow.currency,
			beneficiaries: seatRows
				.filter((seatRow) => seatRow.subscription === ownRow.id)
				.map((seatRow) => seatRow.email)
				.sort(),
		};
	});
}
