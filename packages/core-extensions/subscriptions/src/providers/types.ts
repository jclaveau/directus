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

export type CheckoutAmount = {
	/** ISO 4217, upper case. */
	currency: string;
	/** Two decimals, "9.90" for 9.90 euros. */
	value: string;
};

export type CheckoutStart = {
	directusSubscription: number;
	payerEmail: string;
	amount: CheckoutAmount;
	interval: BillingInterval;
	planName: string;
	redirectUrl: string;
};

/**
 * Where the payer pays: the provider's own page, or a form mounted in ours from
 * `clientToken`, with Stripe.js loaded on `publishableKey`. `inPageRefusal` says
 * why a provider refused the in-page form a hosted page then stands in for.
 */
export type CheckoutPage = (
	| { url: string; inPageRefusal: string | null }
	| { clientToken: string; publishableKey: string | null }
) & {
	/** Mollie: the customer whose payments `findCheckoutPayment` reads. */
	providerCustomerId?: string;
};

export type CheckoutPaymentSearch = {
	customerId: string;
	directusSubscription: number;
};

/** A Mollie first payment, paid: the mandate a checkout's subscription bills. */
export type PaidCheckout = {
	paymentId: string;
	customerId: string;
	mandateId: string;
	paidAt: string;
	amount: CheckoutAmount;
	directusSubscription: number;
	interval: BillingInterval;
};

/** A bill the provider issued: a Stripe invoice, a Mollie payment. */
export type ProviderInvoice = {
	providerReference: string;
	/** The provider's own word: `paid`, `open`, `failed`… */
	status: string;
	/** Two decimals, "9.90" for 9.90 euros. */
	amount: string;
	/** ISO 4217, upper case. */
	currency: string;
	dateIssued: Date;
	datePaid: Date | null;
	hostedUrl: string | null;
	pdfUrl: string | null;
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
	createCheckout(checkoutStart: CheckoutStart): Promise<CheckoutPage>;
	/**
	 * Mollie: the in-page form's payment sends no webhook. Resolves to the
	 * resource id of the checkout's paid first payment, null while unpaid.
	 */
	findCheckoutPayment?(
		checkoutPaymentSearch: CheckoutPaymentSearch,
	): Promise<string | null>;
	/** Resolves to the resource id of the subscription the payment started. */
	startPaidCheckout(paidCheckout: PaidCheckout): Promise<string>;
	/** What the subscription the resource id names was billed, any order. */
	listInvoices(resourceId: string): Promise<ProviderInvoice[]>;
}

export type SubscriptionProviders = Map<string, SubscriptionProvider>;
