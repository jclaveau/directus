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
