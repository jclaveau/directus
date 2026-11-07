import type { IncomingHttpHeaders } from 'node:http';

export type ProviderSubscription = {
	subscriptionId: string;
	customerId: string;
	status: string;
	currentPeriodEnd: Date | null;
	cancelAtPeriodEnd: boolean;
	/** Null when not exactly one plan is named: revoking works, keeping refuses. */
	planReference: string | null;
};

export type ProviderSubscriptionIds = {
	subscriptionId: string;
	customerId: string;
};

export interface SubscriptionProvider {
	/** Resolves to the resource id the sync queue keys the event on. */
	verifyWebhook(
		rawBody: Buffer,
		requestHeaders: IncomingHttpHeaders,
	): Promise<string>;
	fetchSubscription(resourceId: string): Promise<ProviderSubscription>;
	cancelAtPeriodEnd(resourceId: string): Promise<void>;
	composeResourceId(subscriptionIds: ProviderSubscriptionIds): string;
}

export type SubscriptionProviders = Map<string, SubscriptionProvider>;
