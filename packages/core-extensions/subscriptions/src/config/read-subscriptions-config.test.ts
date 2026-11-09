import { describe, expect, test } from 'vitest';
import { readSubscriptionsConfig } from './read-subscriptions-config.js';

describe('readSubscriptionsConfig', () => {
	test('enables no provider when no key is set', () => {
		expect(readSubscriptionsConfig({})).toEqual({ stripe: null, mollie: null });
	});

	test('enables both providers from their keys', () => {
		expect(readSubscriptionsConfig({
			SUBSCRIPTIONS_STRIPE_SECRET_KEY: 'sk_test_1',
			SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET: 'whsec_1',
			SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_1',
		}))
			.toEqual({
				stripe: { secretKey: 'sk_test_1', webhookSecret: 'whsec_1' },
				mollie: { apiKey: 'test_1' },
			});
	});

	test('refuses a Stripe key without its webhook secret', () => {
		expect(() => {
			readSubscriptionsConfig({ SUBSCRIPTIONS_STRIPE_SECRET_KEY: 'sk_test_1' });
		})
			.toThrow(new Error(
				'"SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET" is required when'
				+ ' "SUBSCRIPTIONS_STRIPE_SECRET_KEY" is set',
			));
	});

	test('refuses a Stripe webhook secret without its key', () => {
		expect(() => {
			readSubscriptionsConfig({ SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET: 'whsec_1' });
		})
			.toThrow(new Error(
				'"SUBSCRIPTIONS_STRIPE_SECRET_KEY" is required when'
				+ ' "SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET" is set',
			));
	});

	test('refuses an empty key', () => {
		expect(() => readSubscriptionsConfig({ SUBSCRIPTIONS_MOLLIE_API_KEY: '' }))
			.toThrow(new Error(
				'"SUBSCRIPTIONS_MOLLIE_API_KEY" must be a non-empty string, got ""',
			));
	});

	test('refuses a secret read from a file ending in a newline', () => {
		expect(() => {
			readSubscriptionsConfig({
				SUBSCRIPTIONS_STRIPE_SECRET_KEY: 'sk_test_1',
				SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET: 'whsec_1\n',
			});
		})
			.toThrow(new Error(
				'"SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET" must not start or end with'
				+ ' whitespace, got "whsec_1\\n"',
			));
	});

	test('refuses a key that is not a string', () => {
		expect(() => readSubscriptionsConfig({ SUBSCRIPTIONS_MOLLIE_API_KEY: 12 }))
			.toThrow(new Error(
				'"SUBSCRIPTIONS_MOLLIE_API_KEY" must be a non-empty string, got 12',
			));
	});
});
