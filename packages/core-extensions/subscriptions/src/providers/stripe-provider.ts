import Stripe from 'stripe';
import { WebhookRefusedError } from '../errors.js';
import type { SubscriptionProvider } from './types.js';

export function createStripeProvider(
	stripeClient: Stripe,
	webhookSecret: string,
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
			const stripeSubscription = await stripeClient.subscriptions.retrieve(
				resourceId,
			);

			const [onlyItem, ...otherItems] = stripeSubscription.items.data;

			if (onlyItem === undefined || otherItems.length > 0) {
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
				currentPeriodEnd: new Date(onlyItem.current_period_end * 1000),
				cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
				planReference: onlyItem.price.id,
			};
		},

		async cancelAtPeriodEnd(resourceId) {
			await stripeClient.subscriptions.update(
				resourceId,
				{ cancel_at_period_end: true },
			);
		},

		composeResourceId({ subscriptionId }) {
			return subscriptionId;
		},
	};
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
			throw new WebhookRefusedError({
				provider: 'stripe',
				reason: `invoice ${JSON.stringify(stripeInvoice.id)}`
					+ ' belongs to no subscription',
			});
		}

		return typeof subscriptionReference === 'string'
			? subscriptionReference
			: subscriptionReference.id;
	}

	throw new WebhookRefusedError({
		provider: 'stripe',
		reason: `event type ${JSON.stringify(stripeEvent.type)} is not handled`,
	});
}
