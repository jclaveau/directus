import type { IncomingHttpHeaders } from 'node:http';

export type ProviderSubscription = {
	subscriptionId: string;
	customerId: string;
	status: string;
	currentPeriodEnd: Date | null;
	cancelAtPeriodEnd: boolean;
	/** Null when not exactly one plan is named: revoking works, keeping refuses. */
	planReference: string | null;
	/** Mollie only: the canceled subscription this one resumes. */
	resumedSubscriptionId?: string;
};

export type ProviderSubscriptionIds = {
	subscriptionId: string;
	customerId: string;
};

export type CancelResume = ProviderSubscriptionIds & {
	periodEnd: Date;
};

export type ResumedSubscription = {
	resourceId: string;
	isNewSubscription: boolean;
};

export interface SubscriptionProvider {
	/** Resolves to the resource id the sync queue keys the event on. */
	verifyWebhook(
		rawBody: Buffer,
		requestHeaders: IncomingHttpHeaders,
	): Promise<string>;
	fetchSubscription(resourceId: string): Promise<ProviderSubscription>;
	cancelAtPeriodEnd(resourceId: string): Promise<void>;
	/** Resolves to the resource id to sync: a new subscription's on Mollie. */
	resumeCancel(cancelResume: CancelResume): Promise<ResumedSubscription>;
	composeResourceId(subscriptionIds: ProviderSubscriptionIds): string;
}

export type SubscriptionProviders = Map<string, SubscriptionProvider>;
