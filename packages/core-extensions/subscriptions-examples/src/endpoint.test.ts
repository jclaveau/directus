import { oneLine } from '@directus/utils';
import { describe, expect, test } from 'vitest';
import { readProvidersPort, refuseLiveKeys } from './endpoint.js';
import { composePayPage } from './pay-page/compose-pay-page.js';

describe('refuseLiveKeys', () => {
	test.each([
		['SUBSCRIPTIONS_STRIPE_SECRET_KEY', 'sk_live_218'],
		['SUBSCRIPTIONS_STRIPE_SECRET_KEY', 'rk_live_218'],
		['SUBSCRIPTIONS_MOLLIE_API_KEY', 'live_218'],
	])('refuses %s set to %s', (variableName, providerKey) => {
		expect(() => refuseLiveKeys({ [variableName]: providerKey }))
			.toThrow(new Error(
				'"SUBSCRIPTIONS_EXAMPLES_FAKE_PROVIDERS" fakes Stripe and Mollie,'
				+ ' it refuses to start next to the live key'
				+ ` "${variableName}"`,
			));
	});

	test('accepts test keys', () => {
		expect(refuseLiveKeys({
			SUBSCRIPTIONS_STRIPE_SECRET_KEY: 'sk_test_examples',
			SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_examples',
		})).toBeUndefined();
	});
});

describe('readProvidersPort', () => {
	test('reads the port', () => {
		expect(readProvidersPort({
			SUBSCRIPTIONS_EXAMPLES_PROVIDERS_PORT: 8057,
		})).toBe(8057);
	});

	test('refuses a missing port', () => {
		expect(() => readProvidersPort({}))
			.toThrow(new Error(
				'"SUBSCRIPTIONS_EXAMPLES_FAKE_PROVIDERS" needs the fake providers\''
				+ ' port in "SUBSCRIPTIONS_EXAMPLES_PROVIDERS_PORT", got null',
			));
	});
});

describe('composePayPage', () => {
	test(oneLine`
		names the provider and offers each outcome, escaping the description
	`, () => {
		const payPage = composePayPage({
			provider: 'stripe',
			payment: 'cs_examples_7',
			status: 'open',
			amount: '30.00',
			currency: 'EUR',
			description: 'Team <b>',
		});

		expect(payPage).toContain('<title>Fake Stripe page</title>');
		expect(payPage).toContain('Team &lt;b&gt;');
		expect(payPage).toContain('<button name="outcome" value="paid">paid</button>');

		expect(payPage)
			.toContain('<button name="outcome" value="failed">failed</button>');

		expect(payPage)
			.toContain('<button name="outcome" value="canceled">canceled</button>');
	});
});
