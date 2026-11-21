import { createError } from '@directus/errors';

export const UnknownProviderError = createError<{ provider: string }>(
	'UNKNOWN_SUBSCRIPTION_PROVIDER',
	({ provider }) => {
		return `Subscription provider ${JSON.stringify(provider)}`
			+ ' is not enabled';
	},
	404,
);

export const WebhookRefusedError = createError<{
	provider: string;
	reason: string;
}>(
	'SUBSCRIPTION_WEBHOOK_REFUSED',
	({ provider, reason }) => {
		return `Webhook from ${JSON.stringify(provider)} refused: ${reason}`;
	},
	400,
);

/** A post nobody signed with the webhook secret, whatever its body says. */
export const WebhookSignatureError = createError<{
	provider: string;
	reason: string;
}>(
	'SUBSCRIPTION_WEBHOOK_UNSIGNED',
	({ provider, reason }) => {
		return `Webhook from ${JSON.stringify(provider)} refused: ${reason}`;
	},
	401,
);

/** Never reaches the provider: `receiveWebhook` logs it and answers 200. */
export const WebhookIgnoredError = createError<{
	provider: string;
	reason: string;
}>(
	'SUBSCRIPTION_WEBHOOK_IGNORED',
	({ provider, reason }) => {
		return `Webhook from ${JSON.stringify(provider)} ignored: ${reason}`;
	},
	200,
);

/**
 * Signed, so sent by the provider, yet unreadable: `receiveWebhook` logs it as
 * an error, keeps its body in `subscription_events` and answers 200, since a
 * retry would fail the same way until the provider disables the endpoint.
 */
export const WebhookUnreadableError = createError<{
	provider: string;
	reason: string;
}>(
	'SUBSCRIPTION_WEBHOOK_UNREADABLE',
	({ provider, reason }) => {
		return `Webhook from ${JSON.stringify(provider)} unreadable: ${reason}`;
	},
	200,
);

/** `subscriptionId` is null when a Mollie payment led to no subscription. */
export const MissingProviderSubscriptionError = createError<{
	resourceId: string;
	subscriptionId: string | null;
}>(
	'MISSING_PROVIDER_SUBSCRIPTION',
	({ resourceId }) => {
		return `The provider has no subscription for ${JSON.stringify(resourceId)}`;
	},
	404,
);

export const NoSubscriptionToCancelError = createError(
	'NO_SUBSCRIPTION_TO_CANCEL',
	'No ongoing subscription to cancel',
	404,
);

export const SeveralSubscriptionsToCancelError = createError<{
	subscriptionCount: number;
}>(
	'SEVERAL_SUBSCRIPTIONS_TO_CANCEL',
	({ subscriptionCount }) => {
		return `Found ${JSON.stringify(subscriptionCount)}`
			+ ' ongoing subscriptions to cancel, expected one';
	},
	409,
);

export const NoSubscriptionToResumeError = createError(
	'NO_SUBSCRIPTION_TO_RESUME',
	'No canceled subscription to resume',
	404,
);

export const SeveralSubscriptionsToResumeError = createError<{
	subscriptionCount: number;
}>(
	'SEVERAL_SUBSCRIPTIONS_TO_RESUME',
	({ subscriptionCount }) => {
		return `Found ${JSON.stringify(subscriptionCount)}`
			+ ' canceled subscriptions to resume, expected one';
	},
	409,
);

export const ArchivedPlanResumeError = createError<{ planCode: string }>(
	'ARCHIVED_PLAN_RESUME',
	({ planCode }) => {
		return `Plan ${JSON.stringify(planCode)} is archived,`
			+ ' its subscriptions cannot resume';
	},
	409,
);

/** A new first payment sets up a mandate: the checkout's job, not a resume's. */
export const NoValidMandateError = createError<{ customerId: string }>(
	'NO_VALID_MANDATE',
	({ customerId }) => {
		return `Customer ${JSON.stringify(customerId)} has no valid mandate`
			+ ' to resume with';
	},
	409,
);

/**
 * Not retried: no checkout named a pending row in the provider's metadata, so
 * a later sync finds nothing more. `runSyncBatch` drops the queue row, logged.
 */
export const UnboundProviderSubscriptionError = createError<{
	provider: string;
	subscriptionId: string;
	directusSubscription: number | null;
}>(
	'UNBOUND_PROVIDER_SUBSCRIPTION',
	({ provider, subscriptionId, directusSubscription }) => {
		return `${JSON.stringify(provider)} subscription`
			+ ` ${JSON.stringify(subscriptionId)} names no pending subscription:`
			+ ` its metadata "directus_subscription" is`
			+ ` ${JSON.stringify(directusSubscription)}`;
	},
	404,
);

export const BeneficiariesMaxReachedError = createError<{
	planCode: string;
	beneficiariesMax: number;
}>(
	'BENEFICIARIES_MAX_REACHED',
	({ planCode, beneficiariesMax }) => {
		return `Plan ${JSON.stringify(planCode)} allows`
			+ ` ${JSON.stringify(beneficiariesMax)} beneficiaries, all taken`;
	},
	400,
);

/**
 * Not a failure: a Mollie checkout's first payment, paid, set up a mandate and
 * no subscription yet. `runSyncBatch` creates it at the amount sold.
 */
export const PaidCheckoutError = createError<{
	paymentId: string;
	customerId: string;
	mandateId: string;
	paidAt: string;
	amount: { currency: string; value: string };
	directusSubscription: number;
}>(
	'PAID_CHECKOUT',
	({ paymentId, directusSubscription }) => {
		return `Payment ${JSON.stringify(paymentId)} paid the checkout of`
			+ ` subscription ${JSON.stringify(directusSubscription)},`
			+ ' which has no provider subscription yet';
	},
	409,
);

/** Not retried: `runSyncBatch` expires the pending row the checkout named. */
export const AbandonedCheckoutError = createError<{
	checkoutId: string;
	checkoutStatus: string;
	directusSubscription: number;
}>(
	'ABANDONED_CHECKOUT',
	({ checkoutId, checkoutStatus, directusSubscription }) => {
		return `Checkout ${JSON.stringify(checkoutId)} of subscription`
			+ ` ${JSON.stringify(directusSubscription)} ended`
			+ ` ${JSON.stringify(checkoutStatus)}, unpaid`;
	},
	410,
);
