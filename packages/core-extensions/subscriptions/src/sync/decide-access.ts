import type { ProviderSubscription } from '../providers/types.js';

export type AccessDecision = 'keep' | 'revoke';

const KEEPING_STATUSES = ['active', 'trialing', 'past_due'];

const REVOKING_STATUSES = ['unpaid', 'suspended', 'expired'];

export function decideAccess(
	providerSubscription: Pick<
		ProviderSubscription,
		'status' | 'cancelAtPeriodEnd' | 'currentPeriodEnd'
	>,
	decidedAt: Date,
): AccessDecision {
	const { status, cancelAtPeriodEnd, currentPeriodEnd } = providerSubscription;

	if (REVOKING_STATUSES.includes(status)) {
		return 'revoke';
	}

	if (KEEPING_STATUSES.includes(status)) {
		return 'keep';
	}

	if (status === 'canceled') {
		return cancelAtPeriodEnd
			&& currentPeriodEnd !== null
			&& currentPeriodEnd > decidedAt
			? 'keep'
			: 'revoke';
	}

	throw new Error(
		`Subscription status ${JSON.stringify(status)} has no access rule yet`,
	);
}
