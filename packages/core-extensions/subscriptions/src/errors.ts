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
