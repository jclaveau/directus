import Stripe from 'stripe';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	MissingProviderSubscriptionError,
	WebhookIgnoredError,
	WebhookRefusedError,
} from '../errors.js';
import { createStripeProvider } from './stripe-provider.js';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('verifyWebhook', () => {
	test('resolves a subscription event to the subscription id', async () => {
		const stripeClient = new Stripe('sk_test_1');
		const stripeProvider = createStripeProvider(stripeClient, 'whsec_1');

		const payload = JSON.stringify({
			type: 'customer.subscription.updated',
			data: { object: { id: 'sub_1' } },
		});

		const signatureHeader = stripeClient.webhooks.generateTestHeaderString({
			payload,
			secret: 'whsec_1',
		});

		await expect(stripeProvider.verifyWebhook(
			Buffer.from(payload),
			{ 'stripe-signature': signatureHeader },
		)).resolves.toBe('sub_1');
	});

	test('resolves an invoice event to its subscription id', async () => {
		const stripeClient = new Stripe('sk_test_1');
		const stripeProvider = createStripeProvider(stripeClient, 'whsec_1');

		const payload = JSON.stringify({
			type: 'invoice.paid',
			data: {
				object: {
					id: 'in_1',
					parent: { subscription_details: { subscription: 'sub_1' } },
				},
			},
		});

		const signatureHeader = stripeClient.webhooks.generateTestHeaderString({
			payload,
			secret: 'whsec_1',
		});

		await expect(stripeProvider.verifyWebhook(
			Buffer.from(payload),
			{ 'stripe-signature': signatureHeader },
		)).resolves.toBe('sub_1');
	});

	test('resolves an invoice with an expanded subscription', async () => {
		const stripeClient = new Stripe('sk_test_1');
		const stripeProvider = createStripeProvider(stripeClient, 'whsec_1');

		const payload = JSON.stringify({
			type: 'invoice.payment_failed',
			data: {
				object: {
					id: 'in_1',
					parent: { subscription_details: { subscription: { id: 'sub_2' } } },
				},
			},
		});

		const signatureHeader = stripeClient.webhooks.generateTestHeaderString({
			payload,
			secret: 'whsec_1',
		});

		await expect(stripeProvider.verifyWebhook(
			Buffer.from(payload),
			{ 'stripe-signature': signatureHeader },
		)).resolves.toBe('sub_2');
	});

	test('ignores an invoice without a parent', async () => {
		const stripeClient = new Stripe('sk_test_1');
		const stripeProvider = createStripeProvider(stripeClient, 'whsec_1');

		const payload = JSON.stringify({
			type: 'invoice.paid',
			data: { object: { id: 'in_1', parent: null } },
		});

		const signatureHeader = stripeClient.webhooks.generateTestHeaderString({
			payload,
			secret: 'whsec_1',
		});

		await expect(stripeProvider.verifyWebhook(
			Buffer.from(payload),
			{ 'stripe-signature': signatureHeader },
		)).rejects.toThrow(new WebhookIgnoredError({
			provider: 'stripe',
			reason: 'invoice "in_1" belongs to no subscription',
		}));
	});

	test('ignores an invoice whose parent is no subscription', async () => {
		const stripeClient = new Stripe('sk_test_1');
		const stripeProvider = createStripeProvider(stripeClient, 'whsec_1');

		const payload = JSON.stringify({
			type: 'invoice.paid',
			data: {
				object: { id: 'in_1', parent: { subscription_details: null } },
			},
		});

		const signatureHeader = stripeClient.webhooks.generateTestHeaderString({
			payload,
			secret: 'whsec_1',
		});

		await expect(stripeProvider.verifyWebhook(
			Buffer.from(payload),
			{ 'stripe-signature': signatureHeader },
		)).rejects.toThrow(new WebhookIgnoredError({
			provider: 'stripe',
			reason: 'invoice "in_1" belongs to no subscription',
		}));
	});

	test('ignores an invoice whose subscription is null', async () => {
		const stripeClient = new Stripe('sk_test_1');
		const stripeProvider = createStripeProvider(stripeClient, 'whsec_1');

		const payload = JSON.stringify({
			type: 'invoice.paid',
			data: {
				object: {
					id: 'in_1',
					parent: { subscription_details: { subscription: null } },
				},
			},
		});

		const signatureHeader = stripeClient.webhooks.generateTestHeaderString({
			payload,
			secret: 'whsec_1',
		});

		await expect(stripeProvider.verifyWebhook(
			Buffer.from(payload),
			{ 'stripe-signature': signatureHeader },
		)).rejects.toThrow(new WebhookIgnoredError({
			provider: 'stripe',
			reason: 'invoice "in_1" belongs to no subscription',
		}));
	});

	test('ignores an event type it does not handle', async () => {
		const stripeClient = new Stripe('sk_test_1');
		const stripeProvider = createStripeProvider(stripeClient, 'whsec_1');

		const payload = JSON.stringify({
			type: 'charge.succeeded',
			data: { object: { id: 'ch_1' } },
		});

		const signatureHeader = stripeClient.webhooks.generateTestHeaderString({
			payload,
			secret: 'whsec_1',
		});

		await expect(stripeProvider.verifyWebhook(
			Buffer.from(payload),
			{ 'stripe-signature': signatureHeader },
		)).rejects.toThrow(new WebhookIgnoredError({
			provider: 'stripe',
			reason: 'event type "charge.succeeded" is not handled',
		}));
	});

	test('refuses a body signed with another secret', async () => {
		const stripeClient = new Stripe('sk_test_1');
		const stripeProvider = createStripeProvider(stripeClient, 'whsec_1');

		const payload = JSON.stringify({
			type: 'customer.subscription.updated',
			data: { object: { id: 'sub_1' } },
		});

		const signatureHeader = stripeClient.webhooks.generateTestHeaderString({
			payload,
			secret: 'whsec_other',
		});

		await expect(stripeProvider.verifyWebhook(
			Buffer.from(payload),
			{ 'stripe-signature': signatureHeader },
		)).rejects.toThrow(new WebhookRefusedError({
			provider: 'stripe',
			reason: 'the "stripe-signature" header does not sign the body',
		}));
	});

	test('refuses a request without a signature header', async () => {
		const stripeProvider = createStripeProvider(
			new Stripe('sk_test_1'),
			'whsec_1',
		);

		await expect(stripeProvider.verifyWebhook(Buffer.from('{}'), {}))
			.rejects.toThrow(new WebhookRefusedError({
				provider: 'stripe',
				reason: 'expected one "stripe-signature" header, got null',
			}));
	});

	test('rethrows a signed body that is not JSON', async () => {
		const stripeClient = new Stripe('sk_test_1');
		const stripeProvider = createStripeProvider(stripeClient, 'whsec_1');

		const signatureHeader = stripeClient.webhooks.generateTestHeaderString({
			payload: 'not json',
			secret: 'whsec_1',
		});

		await expect(stripeProvider.verifyWebhook(
			Buffer.from('not json'),
			{ 'stripe-signature': signatureHeader },
		)).rejects.toThrow(new SyntaxError(
			'Unexpected token \'o\', "not json" is not valid JSON',
		));
	});
});

describe('fetchSubscription', () => {
	test('normalizes a one-item subscription', async () => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.subscriptions, 'retrieve').mockResolvedValue({
			id: 'sub_1',
			customer: 'cus_1',
			status: 'active',
			cancel_at_period_end: false,
			items: {
				data: [{ current_period_end: 1_796_083_200, price: { id: 'price_1' } }],
			},
		} as never);

		await expect(createStripeProvider(stripeClient, 'whsec_1')
			.fetchSubscription('sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cus_1',
			status: 'active',
			currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
			cancelAtPeriodEnd: false,
			planReference: 'price_1',
		});

		expect(stripeClient.subscriptions.retrieve).toHaveBeenCalledWith('sub_1');
	});

	test('reads an expanded customer', async () => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.subscriptions, 'retrieve').mockResolvedValue({
			id: 'sub_1',
			customer: { id: 'cus_2' },
			status: 'canceled',
			cancel_at_period_end: true,
			items: {
				data: [{ current_period_end: 1_796_083_200, price: { id: 'price_1' } }],
			},
		} as never);

		await expect(createStripeProvider(stripeClient, 'whsec_1')
			.fetchSubscription('sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cus_2',
			status: 'canceled',
			currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
			cancelAtPeriodEnd: true,
			planReference: 'price_1',
		});
	});

	test('refuses a subscription without items', async () => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.subscriptions, 'retrieve').mockResolvedValue({
			id: 'sub_1',
			items: { data: [] },
		} as never);

		await expect(createStripeProvider(stripeClient, 'whsec_1')
			.fetchSubscription('sub_1')).rejects.toThrow(new Error(
			'Stripe subscription "sub_1" has 0 items, expected one',
		));
	});

	test('names no plan on several items, so a status can still revoke', async () => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.subscriptions, 'retrieve').mockResolvedValue({
			id: 'sub_1',
			customer: 'cus_1',
			status: 'unpaid',
			cancel_at_period_end: false,
			items: {
				data: [
					{ current_period_end: 1_796_083_200, price: { id: 'price_1' } },
					{ current_period_end: 1_796_083_200, price: { id: 'price_2' } },
				],
			},
		} as never);

		expect(await createStripeProvider(stripeClient, 'whsec_1')
			.fetchSubscription('sub_1')).toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cus_1',
			status: 'unpaid',
			currentPeriodEnd: new Date(1_796_083_200_000),
			cancelAtPeriodEnd: false,
			planReference: null,
		});
	});

	test('reports a subscription Stripe does not have', async () => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.subscriptions, 'retrieve').mockRejectedValue(
			new Stripe.errors.StripeInvalidRequestError({
				type: 'invalid_request_error',
				code: 'resource_missing',
				message: 'No such subscription',
			}),
		);

		const fetchFailure = await createStripeProvider(stripeClient, 'whsec_1')
			.fetchSubscription('sub_1')
			.catch((fetchError: unknown) => fetchError);

		expect(fetchFailure).toBeInstanceOf(MissingProviderSubscriptionError);

		expect(fetchFailure).toMatchObject({
			message: 'The provider has no subscription for "sub_1"',
			extensions: { resourceId: 'sub_1', subscriptionId: 'sub_1' },
		});
	});

	test('rethrows any other Stripe failure', async () => {
		const stripeClient = new Stripe('sk_test_1');

		const invalidRequest = new Stripe.errors.StripeInvalidRequestError({
			type: 'invalid_request_error',
			code: 'parameter_invalid_empty',
			message: 'Bad parameter',
		});

		vi.spyOn(stripeClient.subscriptions, 'retrieve')
			.mockRejectedValue(invalidRequest);

		await expect(createStripeProvider(stripeClient, 'whsec_1')
			.fetchSubscription('sub_1')).rejects.toBe(invalidRequest);
	});
});

describe('cancelAtPeriodEnd', () => {
	test('sets cancel_at_period_end on the subscription', async () => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.subscriptions, 'update')
			.mockResolvedValue({} as never);

		await createStripeProvider(stripeClient, 'whsec_1')
			.cancelAtPeriodEnd('sub_1');

		expect(stripeClient.subscriptions.update).toHaveBeenCalledWith(
			'sub_1',
			{ cancel_at_period_end: true },
		);
	});
});

describe('composeResourceId', () => {
	test('keys Stripe resources on the subscription id', () => {
		expect(createStripeProvider(new Stripe('sk_test_1'), 'whsec_1')
			.composeResourceId({ subscriptionId: 'sub_1', customerId: 'cus_1' }))
			.toBe('sub_1');
	});
});
