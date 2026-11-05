import createMollieClient from '@mollie/api-client';
import Stripe from 'stripe';
import type { SubscriptionsConfig } from '../config/read-subscriptions-config.js';
import { UnknownProviderError } from '../errors.js';
import { createMollieProvider } from './mollie-provider.js';
import { createStripeProvider } from './stripe-provider.js';
import type { SubscriptionProvider, SubscriptionProviders } from './types.js';

export function createProviders(
	subscriptionsConfig: SubscriptionsConfig,
): SubscriptionProviders {
	const enabledProviders: SubscriptionProviders = new Map();

	if (subscriptionsConfig.stripe !== null) {
		enabledProviders.set('stripe', createStripeProvider(
			new Stripe(subscriptionsConfig.stripe.secretKey),
			subscriptionsConfig.stripe.webhookSecret,
		));
	}

	if (subscriptionsConfig.mollie !== null) {
		enabledProviders.set('mollie', createMollieProvider(
			createMollieClient({ apiKey: subscriptionsConfig.mollie.apiKey }),
		));
	}

	return enabledProviders;
}

export function findProvider(
	enabledProviders: SubscriptionProviders,
	providerName: string,
): SubscriptionProvider {
	const foundProvider = enabledProviders.get(providerName);

	if (foundProvider === undefined) {
		throw new UnknownProviderError({ provider: providerName });
	}

	return foundProvider;
}
