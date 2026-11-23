import { describe, expect, test } from 'vitest';
import {
	composeRealProviderUrl,
	pickProvidersTarget,
} from './pick-providers-target.mjs';

describe('pickProvidersTarget', () => {
	test.each([
		['/v2/payments/tr_examples_7', null, 'real', true, 'fake'],
		['/v2/payments', '{"customerId":"cst_examples_7"}', 'real', true, 'fake'],
		['/v1/checkout/sessions', 'mode=subscription', 'real', false, 'fake'],
		['/v1/subscriptions/sub_1QxAbc', null, 'fake', true, 'real'],
		['/v2/customers/cst_8wmqcHMN4U/subscriptions', null, 'fake', true, 'real'],
		['/v1/checkout/sessions', 'mode=subscription', 'fake', true, 'fake'],
		['/v1/checkout/sessions', 'mode=subscription', 'real', true, 'real'],
		['/v2/customers', '{"email":"tester@example.com"}', 'real', true, 'real'],
	])(
		'sends %s %s in mode %s (real available: %s) to %s',
		(requestPath, requestText, providersMode, isRealAvailable, target) => {
			expect(pickProvidersTarget({
				requestPath,
				requestText,
				providersMode,
				isRealAvailable,
			})).toBe(target);
		},
	);
});

describe('composeRealProviderUrl', () => {
	test.each([
		[
			'/v1/subscriptions/sub_1Qx?expand[]=items',
			'https://api.stripe.com/v1/subscriptions/sub_1Qx?expand[]=items',
		],
		['/v2/payments/tr_8wmq', 'https://api.mollie.com/v2/payments/tr_8wmq'],
	])('sends %s to %s', (requestUrl, realUrl) => {
		expect(composeRealProviderUrl(requestUrl)).toBe(realUrl);
	});

	test('refuses a path of neither provider', () => {
		expect(() => composeRealProviderUrl('/pay/tr_8wmq'))
			.toThrow(new Error(
				'The real providers answer /v1/ (Stripe) and /v2/ (Mollie), got'
				+ ' "/pay/tr_8wmq"',
			));
	});
});
