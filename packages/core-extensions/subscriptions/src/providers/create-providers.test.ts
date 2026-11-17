import { describe, expect, test, vi } from 'vitest';
import { UnknownProviderError } from '../errors.js';
import { createProviders, findProvider } from './create-providers.js';
import { retryMollieProvider } from './retry-mollie-calls.js';
import type { SubscriptionProvider } from './types.js';

vi.mock('./retry-mollie-calls.js', async (importOriginal) => {
	const retryModule = await importOriginal<
		typeof import('./retry-mollie-calls.js')
	>();

	return {
		...retryModule,
		retryMollieProvider: vi.fn(retryModule.retryMollieProvider),
	};
});

describe('createProviders', () => {
	test('enables no provider without config', () => {
		expect([...createProviders({ stripe: null, mollie: null }).keys()])
			.toEqual([]);
	});

	test('enables each configured provider', () => {
		expect([...createProviders({
			stripe: { secretKey: 'sk_test_1', webhookSecret: 'whsec_1' },
			mollie: {
				apiKey: 'test_1',
				webhookSecrets: ['mollie_secret_1'],
				retry: { maxRetries: 3, delayMs: 1000 },
			},
		}).keys()])
			.toEqual(['stripe', 'mollie']);
	});

	test('retries the Mollie calls as the config sets', () => {
		createProviders({
			stripe: null,
			mollie: {
				apiKey: 'test_1',
				webhookSecrets: ['mollie_secret_1'],
				retry: { maxRetries: 2, delayMs: 500 },
			},
		});

		expect(retryMollieProvider).toHaveBeenCalledWith(
			expect.objectContaining({ fetchSubscription: expect.any(Function) }),
			{ maxRetries: 2, delayMs: 500 },
		);
	});
});

describe('findProvider', () => {
	test('finds an enabled provider', () => {
		const mollieProvider = {} as SubscriptionProvider;

		expect(findProvider(new Map([['mollie', mollieProvider]]), 'mollie'))
			.toBe(mollieProvider);
	});

	test('refuses a provider that is not enabled', () => {
		expect(() => findProvider(new Map(), 'paypal'))
			.toThrow(new UnknownProviderError({ provider: 'paypal' }));
	});
});
