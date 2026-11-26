import Stripe from 'stripe';
import {
	AbandonedCheckoutError,
	MissingProviderSubscriptionError,
	ProviderUnavailableError,
	WebhookIgnoredError,
	WebhookRefusedError,
} from '../errors.js';
import { readDirectusSubscription } from './read-directus-subscription.js';
import { readThrownMessage } from './read-thrown-message.js';
import type {
	BillingInterval,
	ProviderBilling,
	ProviderInvoice,
	SubscriptionProvider,
} from './types.js';

const STRIPE_CHECKOUT_SESSION_ID = /^cs_\w+$/;

const STRIPE_INTERVALS: Record<string, { months: number; days: number }> = {
	year: { months: 12, days: 0 },
	month: { months: 1, days: 0 },
	week: { months: 0, days: 7 },
	day: { months: 0, days: 1 },
};

/** `publishableKey` null: a hosted checkout, no in-page form tried. */
export function createStripeProvider(
	stripeClient: Stripe,
	webhookSecret: string,
	publishableKey: string | null = null,
): SubscriptionProvider {
	return {
		async verifyWebhook(rawBody, requestHeaders) {
			const signatureHeader = requestHeaders['stripe-signature'];

			if (typeof signatureHeader !== 'string') {
				throw new WebhookRefusedError({
					provider: 'stripe',
					reason: 'expected one "stripe-signature" header, got'
						+ ` ${JSON.stringify(signatureHeader ?? null)}`,
				});
			}

			let stripeEvent: Stripe.Event;

			try {
				stripeEvent = stripeClient.webhooks.constructEvent(
					rawBody,
					signatureHeader,
					webhookSecret,
				);
			}
			catch (error) {
				if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
					throw new WebhookRefusedError(
						{
							provider: 'stripe',
							reason: 'the "stripe-signature" header does not sign the body',
						},
						{ cause: error },
					);
				}

				throw error;
			}

			return readEventSubscriptionId(stripeEvent);
		},

		async fetchSubscription(resourceId) {
			if (STRIPE_CHECKOUT_SESSION_ID.test(resourceId)) {
				return await refuseCheckoutSession(stripeClient, resourceId);
			}

			const stripeSubscription = await retrieveStripeSubscription(
				stripeClient,
				resourceId,
			);

			const [firstItem, ...otherItems] = stripeSubscription.items.data;

			if (firstItem === undefined) {
				throw new Error(
					`Stripe subscription ${JSON.stringify(resourceId)} has`
					+ ` ${JSON.stringify(stripeSubscription.items.data.length)}`
					+ ' items, expected one',
				);
			}

			const stripeCustomer = stripeSubscription.customer;

			return {
				subscriptionId: stripeSubscription.id,
				customerId: typeof stripeCustomer === 'string'
					? stripeCustomer
					: stripeCustomer.id,
				status: stripeSubscription.status,
				currentPeriodEnd: new Date(firstItem.current_period_end * 1000),
				// Stripe's `canceled` is over, even past a scheduled end: its flag
				// would otherwise keep the access until the period end.
				cancelAtPeriodEnd: stripeSubscription.status === 'canceled'
					? false
					: stripeSubscription.cancel_at_period_end,
				directusSubscription: readDirectusSubscription(
					stripeSubscription.metadata,
				),
				billing: otherItems.length === 0
					? readStripeBilling(firstItem.price)
					: null,
			};
		},

		async cancelAtPeriodEnd(resourceId) {
			await stripeClient.subscriptions.update(
				resourceId,
				{ cancel_at_period_end: true },
			);
		},

		async resumeCancel({ subscriptionId }) {
			await stripeClient.subscriptions.update(
				subscriptionId,
				{ cancel_at_period_end: false },
			);

			return { resourceId: subscriptionId, isNewSubscription: false };
		},

		composeResourceId({ subscriptionId }) {
			return subscriptionId;
		},

		/**
		 * Both metadata name the row: the session's for its expiry.
		 *
		 * The in-page form first; Stripe refusing its session sends the payer to
		 * the hosted page. Stripe down there too answers 503.
		 */
		async createCheckout({
			directusSubscription,
			payerEmail,
			amount,
			interval,
			planName,
			redirectUrl,
		}) {
			const checkoutMetadata = {
				directus_subscription: String(directusSubscription),
			};

			const sessionParams: Stripe.Checkout.SessionCreateParams = {
				mode: 'subscription',
				customer_email: payerEmail,
				line_items: [{
					quantity: 1,
					price_data: {
						currency: amount.currency.toLowerCase(),
						unit_amount: Math.round(Number(amount.value) * 100),
						recurring: formatStripeRecurring(interval),
						product_data: { name: planName },
					},
				}],
				subscription_data: { metadata: checkoutMetadata },
				metadata: checkoutMetadata,
			};

			let inPageRefusal: string | null = null;

			if (publishableKey !== null) {
				try {
					const inPageSession = await stripeClient.checkout.sessions.create({
						...sessionParams,
						ui_mode: 'elements',
						return_url: redirectUrl,
					});

					if (inPageSession.client_secret === null) {
						throw new Error(
							`Stripe checkout session ${JSON.stringify(inPageSession.id)}`
							+ ' has no client secret',
						);
					}

					return { clientToken: inPageSession.client_secret, publishableKey };
				}
				catch (sessionError) {
					inPageRefusal = readThrownMessage(sessionError);
				}
			}

			const checkoutSession = await stripeClient.checkout.sessions
				.create({
					...sessionParams,
					success_url: redirectUrl,
					cancel_url: redirectUrl,
				})
				.catch(raiseStripeUnavailable);

			if (checkoutSession.url === null) {
				throw new Error(
					`Stripe checkout session ${JSON.stringify(checkoutSession.id)}`
					+ ' has no URL',
				);
			}

			return { url: checkoutSession.url, inPageRefusal };
		},

		async startPaidCheckout({ paymentId }) {
			throw new Error(
				`Stripe starts a checkout's subscription itself, not from payment`
				+ ` ${JSON.stringify(paymentId)}`,
			);
		},

		async listInvoices(resourceId) {
			const providerInvoices: ProviderInvoice[] = [];

			// The list promise pages through every invoice as it is iterated.
			for await (const stripeInvoice of stripeClient.invoices
				.list({ subscription: resourceId, limit: 100 })) {
				providerInvoices.push(readStripeInvoice(stripeInvoice));
			}

			return providerInvoices;
		},
	};
}

/** A paid invoice's paid time is the transition's, not its creation. */
function readStripeInvoice(stripeInvoice: Stripe.Invoice): ProviderInvoice {
	if (stripeInvoice.status === null) {
		throw new Error(
			`Stripe invoice ${JSON.stringify(stripeInvoice.id)} has no status`,
		);
	}

	const paidTime = stripeInvoice.status_transitions.paid_at;

	return {
		providerReference: stripeInvoice.id,
		status: stripeInvoice.status,
		amount: (stripeInvoice.total / 100).toFixed(2),
		currency: stripeInvoice.currency.toUpperCase(),
		dateIssued: new Date(stripeInvoice.created * 1000),
		datePaid: paidTime === null
			? null
			: new Date(paidTime * 1000),
		hostedUrl: stripeInvoice.hosted_invoice_url ?? null,
		pdfUrl: stripeInvoice.invoice_pdf ?? null,
	};
}

function formatStripeRecurring({
	months,
	days,
}: BillingInterval): Stripe.Checkout.SessionCreateParams.LineItem
		.PriceData.Recurring {
	if (months > 0 && days === 0) {
		return months % 12 === 0
			? { interval: 'year', interval_count: months / 12 }
			: { interval: 'month', interval_count: months };
	}

	if (months === 0 && days > 0) {
		return days % 7 === 0
			? { interval: 'week', interval_count: days / 7 }
			: { interval: 'day', interval_count: days };
	}

	throw new Error(
		`Billing interval ${JSON.stringify({ months, days })} is no`
		+ ' Stripe interval',
	);
}

/**
 * A `checkout.session.expired` queues the session: an expired one expires the
 * pending row it names, any other syncs nothing.
 */
async function refuseCheckoutSession(
	stripeClient: Stripe,
	sessionId: string,
): Promise<never> {
	const checkoutSession = await stripeClient.checkout.sessions
		.retrieve(sessionId);

	const directusSubscription = readDirectusSubscription(
		checkoutSession.metadata,
	);

	if (checkoutSession.status === 'expired' && directusSubscription !== null) {
		throw new AbandonedCheckoutError({
			checkoutId: sessionId,
			checkoutStatus: 'expired',
			directusSubscription,
		});
	}

	throw new MissingProviderSubscriptionError({
		resourceId: sessionId,
		subscriptionId: null,
	});
}

/** A metered or one-off price bills no fixed amount per interval. */
function readStripeBilling(stripePrice: Stripe.Price): ProviderBilling | null {
	const { unit_amount: unitAmount, recurring: recurringPrice } = stripePrice;

	if (unitAmount === null || recurringPrice === null) {
		return null;
	}

	const intervalUnit = STRIPE_INTERVALS[recurringPrice.interval]!;

	return {
		amountCents: unitAmount,
		currency: stripePrice.currency.toUpperCase(),
		interval: {
			months: intervalUnit.months * recurringPrice.interval_count,
			days: intervalUnit.days * recurringPrice.interval_count,
		},
	};
}

async function retrieveStripeSubscription(
	stripeClient: Stripe,
	resourceId: string,
) {
	try {
		return await stripeClient.subscriptions.retrieve(resourceId);
	}
	catch (error) {
		if (error instanceof Stripe.errors.StripeError
			&& error.code === 'resource_missing') {
			throw new MissingProviderSubscriptionError(
				{ resourceId, subscriptionId: resourceId },
				{ cause: error },
			);
		}

		throw error;
	}
}

function readEventSubscriptionId(stripeEvent: Stripe.Event): string {
	if (stripeEvent.type.startsWith('customer.subscription.')) {
		return (stripeEvent.data.object as Stripe.Subscription).id;
	}

	if (stripeEvent.type.startsWith('invoice.')) {
		const stripeInvoice = stripeEvent.data.object as Stripe.Invoice;

		const subscriptionReference = stripeInvoice.parent
			?.subscription_details
			?.subscription;

		if (subscriptionReference === undefined
			|| subscriptionReference === null) {
			throw new WebhookIgnoredError({
				provider: 'stripe',
				reason: `invoice ${JSON.stringify(stripeInvoice.id)}`
					+ ' belongs to no subscription',
			});
		}

		return typeof subscriptionReference === 'string'
			? subscriptionReference
			: subscriptionReference.id;
	}

	if (stripeEvent.type === 'checkout.session.expired') {
		return stripeEvent.data.object.id;
	}

	throw new WebhookIgnoredError({
		provider: 'stripe',
		reason: `event type ${JSON.stringify(stripeEvent.type)} is not handled`,
	});
}

/** Unreachable, or Stripe's own failure: a 4xx is the request's, thrown as is. */
function raiseStripeUnavailable(callError: unknown): never {
	if (callError instanceof Stripe.errors.StripeConnectionError
		|| callError instanceof Stripe.errors.StripeAPIError) {
		throw new ProviderUnavailableError({
			provider: 'stripe',
			reason: callError.message,
		});
	}

	throw callError;
}
