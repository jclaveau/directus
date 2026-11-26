import { readFileSync } from 'node:fs';
import Stripe from 'stripe';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	AbandonedCheckoutError,
	MissingProviderSubscriptionError,
	ProviderUnavailableError,
	WebhookIgnoredError,
	WebhookRefusedError,
} from '../errors.js';
import { createStripeProvider } from './stripe-provider.js';

afterEach(() => {
	vi.restoreAllMocks();
});

// What Stripe's test mode sent, recorded by
// scripts/stripe-behaviour/stripe-webhook-probe.mjs.
const recordedEvents = JSON.parse(readFileSync(
	new URL(
		'../../../../../scripts/stripe-behaviour/'
		+ 'stripe-behaviour.recorded-events.json',
		import.meta.url,
	),
	'utf8',
));

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
			metadata: { directus_subscription: '7' },
			items: {
				data: [{
					current_period_end: 1_796_083_200,
					price: {
						id: 'price_1',
						unit_amount: 1000,
						currency: 'eur',
						recurring: { interval: 'month', interval_count: 1 },
					},
				}],
			},
		} as never);

		await expect(createStripeProvider(stripeClient, 'whsec_1')
			.fetchSubscription('sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cus_1',
			status: 'active',
			currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
			cancelAtPeriodEnd: false,
			directusSubscription: 7,
			billing: {
				amountCents: 1000,
				currency: 'EUR',
				interval: { months: 1, days: 0 },
			},
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
			metadata: {},
			items: {
				data: [{
					current_period_end: 1_796_083_200,
					price: {
						id: 'price_1',
						unit_amount: 12000,
						currency: 'eur',
						recurring: { interval: 'year', interval_count: 1 },
					},
				}],
			},
		} as never);

		await expect(createStripeProvider(stripeClient, 'whsec_1')
			.fetchSubscription('sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cus_2',
			status: 'canceled',
			currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
			// Ended at Stripe, even when a cancel at period end was scheduled.
			cancelAtPeriodEnd: false,
			directusSubscription: null,
			billing: {
				amountCents: 12000,
				currency: 'EUR',
				interval: { months: 12, days: 0 },
			},
		});
	});

	test.each([
		[
			{ interval: 'week', interval_count: 2 },
			500,
			{ amountCents: 500, currency: 'EUR', interval: { months: 0, days: 14 } },
		],
		[
			{ interval: 'day', interval_count: 30 },
			500,
			{ amountCents: 500, currency: 'EUR', interval: { months: 0, days: 30 } },
		],
		[{ interval: 'month', interval_count: 1 }, null, null],
		[null, 500, null],
	])('bills %j at %j cents as %j', async (
		recurringPrice,
		unitAmount,
		expectedBilling,
	) => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.subscriptions, 'retrieve').mockResolvedValue({
			id: 'sub_1',
			customer: 'cus_1',
			status: 'active',
			cancel_at_period_end: false,
			metadata: { directus_subscription: '7' },
			items: {
				data: [{
					current_period_end: 1_796_083_200,
					price: {
						id: 'price_1',
						unit_amount: unitAmount,
						currency: 'eur',
						recurring: recurringPrice,
					},
				}],
			},
		} as never);

		expect(await createStripeProvider(stripeClient, 'whsec_1')
			.fetchSubscription('sub_1')).toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cus_1',
			status: 'active',
			currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
			cancelAtPeriodEnd: false,
			directusSubscription: 7,
			billing: expectedBilling,
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

	test('bills nothing on several items, so a status can still revoke', async () => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.subscriptions, 'retrieve').mockResolvedValue({
			id: 'sub_1',
			customer: 'cus_1',
			status: 'unpaid',
			cancel_at_period_end: false,
			metadata: { directus_subscription: '7' },
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
			directusSubscription: 7,
			billing: null,
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

describe('resumeCancel', () => {
	test('clears cancel_at_period_end on the same subscription', async () => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.subscriptions, 'update')
			.mockResolvedValue({} as never);

		await expect(createStripeProvider(stripeClient, 'whsec_1')
			.resumeCancel({
				subscriptionId: 'sub_1',
				customerId: 'cus_1',
				periodEnd: new Date('2026-12-01T00:00:00Z'),
			})).resolves.toEqual({ resourceId: 'sub_1', isNewSubscription: false });

		expect(stripeClient.subscriptions.update).toHaveBeenCalledWith(
			'sub_1',
			{ cancel_at_period_end: false },
		);
	});
});

describe('listInvoices', () => {
	test('lists the subscription invoices, paid or not', async () => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.invoices, 'list').mockReturnValue([
			{
				id: 'in_2',
				status: 'open',
				total: 990,
				currency: 'eur',
				created: 1_798_761_600,
				status_transitions: { paid_at: null },
				hosted_invoice_url: 'https://invoice.stripe.com/i/in_2',
				invoice_pdf: null,
			},
			{
				id: 'in_1',
				status: 'paid',
				total: 2500,
				currency: 'eur',
				created: 1_796_083_200,
				status_transitions: { paid_at: 1_796_083_260 },
				hosted_invoice_url: 'https://invoice.stripe.com/i/in_1',
				invoice_pdf: 'https://pay.stripe.com/invoice/in_1/pdf',
			},
		] as never);

		await expect(createStripeProvider(stripeClient, 'whsec_1')
			.listInvoices('sub_1')).resolves.toEqual([
			{
				providerReference: 'in_2',
				status: 'open',
				amount: '9.90',
				currency: 'EUR',
				dateIssued: new Date('2027-01-01T00:00:00Z'),
				datePaid: null,
				hostedUrl: 'https://invoice.stripe.com/i/in_2',
				pdfUrl: null,
			},
			{
				providerReference: 'in_1',
				status: 'paid',
				amount: '25.00',
				currency: 'EUR',
				dateIssued: new Date('2026-12-01T00:00:00Z'),
				datePaid: new Date('2026-12-01T00:01:00Z'),
				hostedUrl: 'https://invoice.stripe.com/i/in_1',
				pdfUrl: 'https://pay.stripe.com/invoice/in_1/pdf',
			},
		]);

		expect(stripeClient.invoices.list)
			.toHaveBeenCalledWith({ subscription: 'sub_1', limit: 100 });
	});

	test('refuses an invoice with no status', async () => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.invoices, 'list').mockReturnValue([
			{ id: 'in_1', status: null },
		] as never);

		await expect(createStripeProvider(stripeClient, 'whsec_1')
			.listInvoices('sub_1'))
			.rejects.toThrow(new Error('Stripe invoice "in_1" has no status'));
	});
});

describe('composeResourceId', () => {
	test('keys Stripe resources on the subscription id', () => {
		expect(createStripeProvider(new Stripe('sk_test_1'), 'whsec_1')
			.composeResourceId({ subscriptionId: 'sub_1', customerId: 'cus_1' }))
			.toBe('sub_1');
	});
});

describe('checkout', () => {
	test('resolves an expired checkout session event to the session', async () => {
		const stripeClient = new Stripe('sk_test_1');
		const stripeProvider = createStripeProvider(stripeClient, 'whsec_1');

		const payload = JSON.stringify({
			type: 'checkout.session.expired',
			data: { object: { id: 'cs_5' } },
		});

		const signatureHeader = stripeClient.webhooks.generateTestHeaderString({
			payload,
			secret: 'whsec_1',
		});

		await expect(stripeProvider.verifyWebhook(
			Buffer.from(payload),
			{ 'stripe-signature': signatureHeader },
		)).resolves.toBe('cs_5');
	});

	test.each([
		[{ months: 1, days: 0 }, { interval: 'month', interval_count: 1 }],
		[{ months: 24, days: 0 }, { interval: 'year', interval_count: 2 }],
		[{ months: 0, days: 14 }, { interval: 'week', interval_count: 2 }],
		[{ months: 0, days: 10 }, { interval: 'day', interval_count: 10 }],
	])('opens a session billing %j as %j', async (billingInterval, recurring) => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.checkout.sessions, 'create').mockResolvedValue({
			id: 'cs_5',
			url: 'https://checkout.stripe.com/c/pay/cs_5',
		} as never);

		await expect(createStripeProvider(stripeClient, 'whsec_1')
			.createCheckout({
				directusSubscription: 5,
				payerEmail: 'payer@example.com',
				amount: { currency: 'EUR', value: '14.90' },
				interval: billingInterval,
				planName: 'Pro',
				redirectUrl: 'https://shop.example.com/ok',
			}))
			.resolves.toEqual({
				url: 'https://checkout.stripe.com/c/pay/cs_5',
				inPageRefusal: null,
			});

		expect(stripeClient.checkout.sessions.create).toHaveBeenCalledWith({
			mode: 'subscription',
			customer_email: 'payer@example.com',
			line_items: [{
				quantity: 1,
				price_data: {
					currency: 'eur',
					unit_amount: 1490,
					recurring,
					product_data: { name: 'Pro' },
				},
			}],
			subscription_data: { metadata: { directus_subscription: '5' } },
			metadata: { directus_subscription: '5' },
			success_url: 'https://shop.example.com/ok',
			cancel_url: 'https://shop.example.com/ok',
		});
	});

	test('opens the in-page form under a publishable key', async () => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.checkout.sessions, 'create').mockResolvedValue({
			id: 'cs_5',
			client_secret: 'cs_5_secret_7',
		} as never);

		await expect(createStripeProvider(stripeClient, 'whsec_1', 'pk_test_1')
			.createCheckout({
				directusSubscription: 5,
				payerEmail: 'payer@example.com',
				amount: { currency: 'EUR', value: '14.90' },
				interval: { months: 1, days: 0 },
				planName: 'Pro',
				redirectUrl: 'https://shop.example.com/ok',
			}))
			.resolves.toEqual({
				clientToken: 'cs_5_secret_7',
				publishableKey: 'pk_test_1',
			});

		expect(stripeClient.checkout.sessions.create).toHaveBeenCalledWith({
			mode: 'subscription',
			customer_email: 'payer@example.com',
			line_items: [{
				quantity: 1,
				price_data: {
					currency: 'eur',
					unit_amount: 1490,
					recurring: { interval: 'month', interval_count: 1 },
					product_data: { name: 'Pro' },
				},
			}],
			subscription_data: { metadata: { directus_subscription: '5' } },
			metadata: { directus_subscription: '5' },
			ui_mode: 'elements',
			return_url: 'https://shop.example.com/ok',
		});
	});

	test.each([
		[
			new Stripe.errors.StripeInvalidRequestError({
				type: 'invalid_request_error',
				message: 'ui_mode elements is not enabled',
			}),
			'ui_mode elements is not enabled',
		],
		[
			{ id: 'cs_4', client_secret: null },
			'Stripe checkout session "cs_4" has no client secret',
		],
	])('sends the payer to its page when the form fails: %s', async (
		inPageAnswer,
		inPageRefusal,
	) => {
		const stripeClient = new Stripe('sk_test_1');

		const createSpy = vi.spyOn(stripeClient.checkout.sessions, 'create');

		if (inPageAnswer instanceof Error) {
			createSpy.mockRejectedValueOnce(inPageAnswer);
		}
		else {
			createSpy.mockResolvedValueOnce(inPageAnswer as never);
		}

		createSpy.mockResolvedValueOnce({
			id: 'cs_5',
			url: 'https://checkout.stripe.com/c/pay/cs_5',
		} as never);

		await expect(createStripeProvider(stripeClient, 'whsec_1', 'pk_test_1')
			.createCheckout({
				directusSubscription: 5,
				payerEmail: 'payer@example.com',
				amount: { currency: 'EUR', value: '14.90' },
				interval: { months: 1, days: 0 },
				planName: 'Pro',
				redirectUrl: 'https://shop.example.com/ok',
			}))
			.resolves.toEqual({
				url: 'https://checkout.stripe.com/c/pay/cs_5',
				inPageRefusal,
			});

		expect(createSpy).toHaveBeenLastCalledWith(expect.objectContaining({
			success_url: 'https://shop.example.com/ok',
			cancel_url: 'https://shop.example.com/ok',
		}));
	});

	test.each([
		[new Stripe.errors.StripeConnectionError({ message: 'socket hang up' })],
		[new Stripe.errors.StripeAPIError({ message: 'Internal error' })],
	])('answers 503 when Stripe is down: %s', async (stripeFailure) => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.checkout.sessions, 'create')
			.mockRejectedValue(stripeFailure);

		await expect(createStripeProvider(stripeClient, 'whsec_1', 'pk_test_1')
			.createCheckout({
				directusSubscription: 5,
				payerEmail: 'payer@example.com',
				amount: { currency: 'EUR', value: '14.90' },
				interval: { months: 1, days: 0 },
				planName: 'Pro',
				redirectUrl: 'https://shop.example.com/ok',
			}))
			.rejects.toThrow(new ProviderUnavailableError({
				provider: 'stripe',
				reason: stripeFailure.message,
			}));
	});

	test('throws a refused hosted session as Stripe sent it', async () => {
		const stripeClient = new Stripe('sk_test_1');

		const invalidRequest = new Stripe.errors.StripeInvalidRequestError({
			type: 'invalid_request_error',
			message: 'Invalid currency: xyz',
		});

		vi.spyOn(stripeClient.checkout.sessions, 'create')
			.mockRejectedValue(invalidRequest);

		await expect(createStripeProvider(stripeClient, 'whsec_1')
			.createCheckout({
				directusSubscription: 5,
				payerEmail: 'payer@example.com',
				amount: { currency: 'XYZ', value: '14.90' },
				interval: { months: 1, days: 0 },
				planName: 'Pro',
				redirectUrl: 'https://shop.example.com/ok',
			}))
			.rejects.toBe(invalidRequest);
	});

	test('refuses a session without a URL', async () => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.checkout.sessions, 'create')
			.mockResolvedValue({ id: 'cs_5', url: null } as never);

		await expect(createStripeProvider(stripeClient, 'whsec_1')
			.createCheckout({
				directusSubscription: 5,
				payerEmail: 'payer@example.com',
				amount: { currency: 'EUR', value: '14.90' },
				interval: { months: 1, days: 0 },
				planName: 'Pro',
				redirectUrl: 'https://shop.example.com/ok',
			}))
			.rejects.toThrow('Stripe checkout session "cs_5" has no URL');
	});

	test.each([
		[{ months: 1, days: 3 }],
		[{ months: 0, days: 0 }],
	])('refuses a %j interval Stripe cannot bill', async (billingInterval) => {
		await expect(createStripeProvider(new Stripe('sk_test_1'), 'whsec_1')
			.createCheckout({
				directusSubscription: 5,
				payerEmail: 'payer@example.com',
				amount: { currency: 'EUR', value: '14.90' },
				interval: billingInterval,
				planName: 'Pro',
				redirectUrl: 'https://shop.example.com/ok',
			}))
			.rejects.toThrow(
				`Billing interval ${JSON.stringify(billingInterval)} is no`
				+ ' Stripe interval',
			);
	});

	test('starts no subscription from a payment, Stripe does it', async () => {
		await expect(createStripeProvider(new Stripe('sk_test_1'), 'whsec_1')
			.startPaidCheckout({
				paymentId: 'pi_5',
				customerId: 'cus_5',
				mandateId: 'none',
				paidAt: '2026-11-05T10:00:00Z',
				amount: { currency: 'EUR', value: '14.90' },
				directusSubscription: 5,
				interval: { months: 1, days: 0 },
			}))
			.rejects.toThrow(
				'Stripe starts a checkout\'s subscription itself, not from payment'
				+ ' "pi_5"',
			);
	});

	test('reports an expired session as an abandoned checkout', async () => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.checkout.sessions, 'retrieve').mockResolvedValue({
			id: 'cs_5',
			status: 'expired',
			metadata: { directus_subscription: '5' },
		} as never);

		const fetchFailure = await createStripeProvider(stripeClient, 'whsec_1')
			.fetchSubscription('cs_5')
			.catch((fetchError: unknown) => fetchError);

		expect(fetchFailure).toBeInstanceOf(AbandonedCheckoutError);

		expect(fetchFailure).toMatchObject({
			message: 'Checkout "cs_5" of subscription 5 ended "expired", unpaid',
			extensions: {
				checkoutId: 'cs_5',
				checkoutStatus: 'expired',
				directusSubscription: 5,
			},
		});

		expect(stripeClient.checkout.sessions.retrieve)
			.toHaveBeenCalledWith('cs_5');
	});

	test.each([
		[{ status: 'complete', metadata: { directus_subscription: '5' } }],
		[{ status: 'expired', metadata: {} }],
	])('reports a session %j as no subscription', async (sessionFields) => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.checkout.sessions, 'retrieve')
			.mockResolvedValue({ id: 'cs_5', ...sessionFields } as never);

		const fetchFailure = await createStripeProvider(stripeClient, 'whsec_1')
			.fetchSubscription('cs_5')
			.catch((fetchError: unknown) => fetchError);

		expect(fetchFailure).toBeInstanceOf(MissingProviderSubscriptionError);

		expect(fetchFailure).toMatchObject({
			message: 'The provider has no subscription for "cs_5"',
			extensions: { resourceId: 'cs_5', subscriptionId: null },
		});
	});
});

describe('recorded Stripe events', () => {
	test.each([
		'subscription created: customer.subscription.created',
		'subscription created: invoice.created',
		'subscription created: invoice.finalized',
		'subscription created: invoice.paid',
		'subscription created: invoice.payment_succeeded',
		'cancel_at_period_end true: customer.subscription.updated',
		'cancel_at_period_end false: customer.subscription.updated',
		'renewal (test clock past the period end): customer.subscription.updated',
		'renewal (test clock past the period end): invoice.created',
		'renewal (test clock past the period end): invoice.finalized',
		'renewal (test clock past the period end): invoice.paid',
		'renewal (test clock past the period end): invoice.payment_succeeded',
		'renewal (test clock past the period end): invoice.upcoming',
		'renewal (test clock past the period end): invoice.updated',
		'canceled now: customer.subscription.deleted',
	])('verifyWebhook resolves %s to its subscription', async (recordedKey) => {
		const stripeClient = new Stripe('sk_test_1');
		const stripeProvider = createStripeProvider(stripeClient, 'whsec_1');
		const payload = JSON.stringify(recordedEvents[recordedKey]);

		const signatureHeader = stripeClient.webhooks.generateTestHeaderString({
			payload,
			secret: 'whsec_1',
		});

		await expect(stripeProvider.verifyWebhook(
			Buffer.from(payload),
			{ 'stripe-signature': signatureHeader },
		)).resolves.toBe('sub_recorded1');
	});

	test('fetchSubscription reads a subscription set to cancel', async () => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.subscriptions, 'retrieve').mockResolvedValue(
			recordedEvents['cancel_at_period_end true: customer.subscription.updated']
				.data.object,
		);

		await expect(createStripeProvider(stripeClient, 'whsec_1')
			.fetchSubscription('sub_recorded1')).resolves.toEqual({
			subscriptionId: 'sub_recorded1',
			customerId: 'cus_recorded1',
			status: 'active',
			currentPeriodEnd: new Date('2026-12-19T10:15:17Z'),
			cancelAtPeriodEnd: true,
			directusSubscription: 424242,
			billing: {
				amountCents: 1000,
				currency: 'EUR',
				interval: { months: 1, days: 0 },
			},
		});
	});

	test('fetchSubscription reads a subscription canceled now', async () => {
		const stripeClient = new Stripe('sk_test_1');

		vi.spyOn(stripeClient.subscriptions, 'retrieve').mockResolvedValue(
			recordedEvents['canceled now: customer.subscription.deleted'].data.object,
		);

		await expect(createStripeProvider(stripeClient, 'whsec_1')
			.fetchSubscription('sub_recorded1')).resolves.toEqual({
			subscriptionId: 'sub_recorded1',
			customerId: 'cus_recorded1',
			status: 'canceled',
			currentPeriodEnd: new Date('2027-01-19T10:15:17Z'),
			cancelAtPeriodEnd: false,
			directusSubscription: 424242,
			billing: {
				amountCents: 1000,
				currency: 'EUR',
				interval: { months: 1, days: 0 },
			},
		});
	});
});
