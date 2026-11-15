import type { IncomingHttpHeaders } from 'node:http';

export type ProviderSubscription = {
	subscriptionId: string;
	customerId: string;
	status: string;
	currentPeriodEnd: Date | null;
	cancelAtPeriodEnd: boolean;
	/** The `subscriptions.id` the checkout wrote into the provider's metadata. */
	directusSubscription: number | null;
	/** Null when the provider bills several prices at once. */
	billing: ProviderBilling | null;
	/** Mollie only: the canceled subscription this one resumes. */
	resumedSubscriptionId?: string;
};

/** Years count as 12 months and weeks as 7 days, as on the plan's interval. */
export type BillingInterval = {
	months: number;
	days: number;
};

export type ProviderBilling = {
	amountCents: number;
	/** ISO 4217, upper case. */
	currency: string;
	interval: BillingInterval;
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
