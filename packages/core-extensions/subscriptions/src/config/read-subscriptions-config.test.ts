import { describe, expect, test } from 'vitest';
import {
	readMollieApiKey,
	readReconcileCron,
	readSubscriptionsConfig,
} from './read-subscriptions-config.js';

describe('readSubscriptionsConfig', () => {
	test('enables no provider when no key is set', () => {
		expect(readSubscriptionsConfig({})).toEqual({ stripe: null, mollie: null });
	});

	test('enables both providers from their keys', () => {
		expect(readSubscriptionsConfig({
			SUBSCRIPTIONS_STRIPE_SECRET_KEY: 'sk_test_1',
			SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET: 'whsec_1',
			SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_1',
			SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS: 'mollie_secret_1',
		}))
			.toEqual({
				stripe: { secretKey: 'sk_test_1', webhookSecret: 'whsec_1' },
				mollie: {
					apiKey: 'test_1',
					webhookSecrets: ['mollie_secret_1'],
					retry: { maxRetries: 3, delayMs: 1000 },
				},
			});
	});

	test('reads every Mollie webhook secret listed, trimmed', () => {
		expect(readSubscriptionsConfig({
			SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_1',
			SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS: 'mollie_secret_new, mollie_secret_old',
		}))
			.toEqual({
				stripe: null,
				mollie: {
					apiKey: 'test_1',
					webhookSecrets: ['mollie_secret_new', 'mollie_secret_old'],
					retry: { maxRetries: 3, delayMs: 1000 },
				},
			});
	});

	test('reads the Mollie retry settings', () => {
		expect(readSubscriptionsConfig({
			SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_1',
			SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS: 'mollie_secret_1',
			SUBSCRIPTIONS_MOLLIE_RETRY_MAX_RETRIES: 0,
			SUBSCRIPTIONS_MOLLIE_RETRY_DELAY_MS: 250,
		}))
			.toEqual({
				stripe: null,
				mollie: {
					apiKey: 'test_1',
					webhookSecrets: ['mollie_secret_1'],
					retry: { maxRetries: 0, delayMs: 250 },
				},
			});
	});

	test.each([-1, 11, 1.5, '3'])(
		'refuses %j Mollie retries',
		(maxRetries) => {
			expect(() => {
				readSubscriptionsConfig({
					SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_1',
					SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS: 'mollie_secret_1',
					SUBSCRIPTIONS_MOLLIE_RETRY_MAX_RETRIES: maxRetries,
				});
			})
				.toThrow(new Error(
					'"SUBSCRIPTIONS_MOLLIE_RETRY_MAX_RETRIES" must be an integer'
					+ ` from 0 to 10, got ${JSON.stringify(maxRetries)}`,
				));
		},
	);

	test.each([-1, 60_001, 0.5])(
		'refuses a Mollie retry delay of %j ms',
		(delayMs) => {
			expect(() => {
				readSubscriptionsConfig({
					SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_1',
					SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS: 'mollie_secret_1',
					SUBSCRIPTIONS_MOLLIE_RETRY_DELAY_MS: delayMs,
				});
			})
				.toThrow(new Error(
					'"SUBSCRIPTIONS_MOLLIE_RETRY_DELAY_MS" must be an integer'
					+ ` from 0 to 60000, got ${JSON.stringify(delayMs)}`,
				));
		},
	);

	test('refuses a bad Mollie retry setting with Mollie disabled', () => {
		expect(() => {
			readSubscriptionsConfig({ SUBSCRIPTIONS_MOLLIE_RETRY_MAX_RETRIES: -1 });
		})
			.toThrow(new Error(
				'"SUBSCRIPTIONS_MOLLIE_RETRY_MAX_RETRIES" must be an integer'
				+ ' from 0 to 10, got -1',
			));
	});

	test.each([
		['mollie_secret_new,,mollie_secret_old', 2],
		['mollie_secret_new, ,mollie_secret_old', 2],
		['mollie_secret_new,', 2],
		[',mollie_secret_old', 1],
	])('refuses the Mollie webhook secrets %j', (webhookSecrets, emptyPosition) => {
		expect(() => {
			readSubscriptionsConfig({
				SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_1',
				SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS: webhookSecrets,
			});
		})
			.toThrow(new Error(
				'"SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS" lists an empty secret'
				+ ` at position ${emptyPosition}`,
			));
	});

	test('refuses a Mollie key without its webhook secret', () => {
		expect(() => {
			readSubscriptionsConfig({ SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_1' });
		})
			.toThrow(new Error(
				'"SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS" is required when'
				+ ' "SUBSCRIPTIONS_MOLLIE_API_KEY" is set',
			));
	});

	test('refuses a Mollie webhook secret without its key', () => {
		expect(() => {
			readSubscriptionsConfig({
				SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS: 'mollie_secret_1',
			});
		})
			.toThrow(new Error(
				'"SUBSCRIPTIONS_MOLLIE_API_KEY" is required when'
				+ ' "SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS" is set',
			));
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

describe('readReconcileCron', () => {
	test('reconciles every 15 minutes by default', () => {
		expect(readReconcileCron({})).toBe('*/15 * * * *');
	});

	test('reads the schedule set', () => {
		expect(readReconcileCron({ SUBSCRIPTIONS_RECONCILE_CRON: '0 * * * *' }))
			.toBe('0 * * * *');
	});

	test('refuses a schedule that is not a string', () => {
		expect(() => readReconcileCron({ SUBSCRIPTIONS_RECONCILE_CRON: 15 }))
			.toThrow(new Error(
				'"SUBSCRIPTIONS_RECONCILE_CRON" must be a non-empty string, got 15',
			));
	});
});

describe('readMollieApiKey', () => {
	test('reads the key alone, before any webhook secret exists', () => {
		expect(readMollieApiKey({ SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_1' }))
			.toBe('test_1');
	});

	test('refuses a missing key', () => {
		expect(() => readMollieApiKey({}))
			.toThrow(new Error(
				'"SUBSCRIPTIONS_MOLLIE_API_KEY" is required to create a Mollie webhook',
			));
	});
});
