import { describe, expect, test } from 'vitest';
import {
	readCheckoutUrlAllowList,
	readMollieAccessToken,
	readReconcileCron,
	readSubscriptionsConfig,
} from './read-subscriptions-config.js';

describe('readSubscriptionsConfig', () => {
	test('enables no provider when no key is set', () => {
		expect(readSubscriptionsConfig({})).toEqual({
			checkoutUi: 'in_page',
			stripe: null,
			mollie: null,
		});
	});

	test('enables both providers from their keys', () => {
		expect(readSubscriptionsConfig({
			SUBSCRIPTIONS_STRIPE_SECRET_KEY: 'sk_test_1',
			SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET: 'whsec_1',
			SUBSCRIPTIONS_STRIPE_PUBLISHABLE_KEY: 'pk_test_1',
			SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_1',
			SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS: 'mollie_secret_1',
		}))
			.toEqual({
				checkoutUi: 'in_page',
				stripe: {
					secretKey: 'sk_test_1',
					webhookSecret: 'whsec_1',
					publishableKey: 'pk_test_1',
				},
				mollie: {
					apiKey: 'test_1',
					webhookSecrets: ['mollie_secret_1'],
				},
			});
	});

	test('reads every Mollie webhook secret listed, trimmed', () => {
		expect(readSubscriptionsConfig({
			SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_1',
			SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS: 'mollie_secret_new, mollie_secret_old',
		}))
			.toEqual({
				checkoutUi: 'in_page',
				stripe: null,
				mollie: {
					apiKey: 'test_1',
					webhookSecrets: ['mollie_secret_new', 'mollie_secret_old'],
				},
			});
	});

	test('sends the payer to the Stripe page without a publishable key', () => {
		expect(readSubscriptionsConfig({
			SUBSCRIPTIONS_CHECKOUT_UI: 'hosted',
			SUBSCRIPTIONS_STRIPE_SECRET_KEY: 'sk_test_1',
			SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET: 'whsec_1',
			SUBSCRIPTIONS_STRIPE_PUBLISHABLE_KEY: 'pk_test_1',
		}))
			.toEqual({
				checkoutUi: 'hosted',
				stripe: {
					secretKey: 'sk_test_1',
					webhookSecret: 'whsec_1',
					publishableKey: null,
				},
				mollie: null,
			});
	});

	test('refuses an in-page Stripe checkout without a publishable key', () => {
		expect(() => {
			readSubscriptionsConfig({
				SUBSCRIPTIONS_STRIPE_SECRET_KEY: 'sk_test_1',
				SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET: 'whsec_1',
			});
		})
			.toThrow(new Error(
				'"SUBSCRIPTIONS_STRIPE_PUBLISHABLE_KEY" is required when'
				+ ' "SUBSCRIPTIONS_STRIPE_SECRET_KEY" is set and'
				+ ' "SUBSCRIPTIONS_CHECKOUT_UI" is "in_page"',
			));
	});

	test('refuses a checkout UI it does not know', () => {
		expect(() => readSubscriptionsConfig({ SUBSCRIPTIONS_CHECKOUT_UI: 'popup' }))
			.toThrow(new Error(
				'"SUBSCRIPTIONS_CHECKOUT_UI" must be one of ["in_page","hosted"],'
				+ ' got "popup"',
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
				+ ' whitespace',
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

describe('readMollieAccessToken', () => {
	test('reads the organization access token, no API key needed', () => {
		expect(readMollieAccessToken({
			SUBSCRIPTIONS_MOLLIE_ACCESS_TOKEN: 'mollie_token_1',
		}))
			.toBe('mollie_token_1');
	});

	test('refuses a missing token, though the API key is set', () => {
		expect(() => readMollieAccessToken({ SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_1' }))
			.toThrow(new Error(
				'"SUBSCRIPTIONS_MOLLIE_ACCESS_TOKEN" is required to create a Mollie'
				+ ' webhook: Mollie refuses an API key there',
			));
	});
});

describe('readCheckoutUrlAllowList', () => {
	test('allows no URL when unset', () => {
		expect(readCheckoutUrlAllowList({})).toEqual([]);
	});

	test.each([
		'https://shop.example.com/ok, https://shop.example.com/ko',
		['https://shop.example.com/ok', 'https://shop.example.com/ko'],
	])('reads the URLs listed in %j', (listedUrls) => {
		expect(readCheckoutUrlAllowList({
			SUBSCRIPTIONS_CHECKOUT_URL_ALLOW_LIST: listedUrls,
		}))
			.toEqual([
				new URL('https://shop.example.com/ok'),
				new URL('https://shop.example.com/ko'),
			]);
	});

	test('refuses a list that is neither a string nor an array', () => {
		expect(() => {
			return readCheckoutUrlAllowList({
				SUBSCRIPTIONS_CHECKOUT_URL_ALLOW_LIST: 15,
			});
		})
			.toThrow(new Error(
				'"SUBSCRIPTIONS_CHECKOUT_URL_ALLOW_LIST" must be a list of URLs,'
				+ ' got 15',
			));
	});

	test.each([
		['https://shop.example.com/ok,shop', '"shop"'],
		[['https://shop.example.com/ok', 15], '15'],
	])('refuses %j, which lists a non-URL', (listedUrls, refusedEntry) => {
		expect(() => {
			return readCheckoutUrlAllowList({
				SUBSCRIPTIONS_CHECKOUT_URL_ALLOW_LIST: listedUrls,
			});
		})
			.toThrow(new Error(
				`"SUBSCRIPTIONS_CHECKOUT_URL_ALLOW_LIST" lists ${refusedEntry},`
				+ ' which is not a URL',
			));
	});
});
