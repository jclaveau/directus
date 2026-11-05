import type { ProviderSubscription } from '../providers/types.js';

export type AccessDecision = 'keep' | 'revoke';

const KEEPING_STATUSES = ['active', 'trialing', 'past_due'];

const REVOKING_STATUSES = [
	'unpaid',
	'suspended',
	'expired',
	'paused',
	'incomplete',
	'incomplete_expired',
	'pending',
];

export function decideAccess(
	providerSubscription: Pick<
		ProviderSubscription,
		'status' | 'cancelAtPeriodEnd' | 'currentPeriodEnd'
	>,
	decidedAt: Date,
	logger: { warn: (message: string) => void },
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

	// A paid product is not kept by a status no rule covers.
	logger.warn(
		`Subscription status ${JSON.stringify(status)} has no access rule,`
		+ ' revoking its access',
	);

	return 'revoke';
}
