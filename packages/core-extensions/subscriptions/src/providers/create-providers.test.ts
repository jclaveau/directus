import { describe, expect, test, vi } from 'vitest';
import { UnknownProviderError } from '../errors.js';
import { createProviders, findProvider } from './create-providers.js';
import type { SubscriptionProvider } from './types.js';

const { createdMollieProvider } = vi.hoisted(() => {
	return { createdMollieProvider: { fetchSubscription: vi.fn() } };
});

vi.mock('./mollie-provider.js', () => {
	return { createMollieProvider: () => createdMollieProvider };
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
			},
		}).keys()])
			.toEqual(['stripe', 'mollie']);
	});

	// The sync queue retries a failed call, with its backoff, at no worker's cost.
	test('calls Mollie as is, a failure left to the sync queue', () => {
		expect(createProviders({
			stripe: null,
			mollie: { apiKey: 'test_1', webhookSecrets: ['mollie_secret_1'] },
		}).get('mollie'))
			.toBe(createdMollieProvider);
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
