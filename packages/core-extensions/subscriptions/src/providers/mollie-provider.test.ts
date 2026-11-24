import { oneLine } from '@directus/utils';
import { MollieApiError, type MollieClient } from '@mollie/api-client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	AbandonedCheckoutError,
	MissingProviderSubscriptionError,
	NoValidMandateError,
	PaidCheckoutError,
	WebhookIgnoredError,
	WebhookSignatureError,
	WebhookUnreadableError,
} from '../errors.js';
import { createMollieProvider } from './mollie-provider.js';

describe('verifyWebhook', () => {
	test('queues the payment of a signed event without calling Mollie', async () => {
		await expect(createMollieProvider({} as MollieClient, ['mollie_secret_1'])
			.verifyWebhook(
				Buffer.from('{"type":"payment.paid","entityId":"tr_1"}'),
				{
					'x-mollie-signature': 'sha256='
						+ '11da12aa76cb8250b01791f1bbb74df86020069415b315ef4a2a3ecec9a47bc3',
				},
			))
			.resolves.toBe('tr_1');
	});

	test('queues the payment of an event signed with an older secret', async () => {
		await expect(createMollieProvider(
			{} as MollieClient,
			['mollie_secret_new', 'mollie_secret_1'],
		)
			.verifyWebhook(
				Buffer.from('{"type":"payment.paid","entityId":"tr_1"}'),
				{
					'x-mollie-signature': 'sha256='
						+ '11da12aa76cb8250b01791f1bbb74df86020069415b315ef4a2a3ecec9a47bc3',
				},
			))
			.resolves.toBe('tr_1');
	});

	test('refuses an event signed with no secret listed', async () => {
		await expect(createMollieProvider(
			{} as MollieClient,
			['mollie_secret_new', 'mollie_secret_old'],
		)
			.verifyWebhook(
				Buffer.from('{"type":"payment.paid","entityId":"tr_1"}'),
				{
					'x-mollie-signature': 'sha256='
						+ '11da12aa76cb8250b01791f1bbb74df86020069415b315ef4a2a3ecec9a47bc3',
				},
			))
			.rejects.toThrow(new WebhookSignatureError({
				provider: 'mollie',
				reason: 'the "x-mollie-signature" header does not sign the body',
			}));
	});

	test('ignores the empty body of a webhook check', async () => {
		await expect(createMollieProvider({} as MollieClient, ['mollie_secret_1'])
			.verifyWebhook(Buffer.from(''), {}))
			.rejects.toThrow(new WebhookIgnoredError({
				provider: 'mollie',
				reason: 'the body is empty',
			}));
	});

	test('refuses a classic webhook, which Mollie does not sign', async () => {
		await expect(createMollieProvider({} as MollieClient, ['mollie_secret_1'])
			.verifyWebhook(Buffer.from('id=tr_1'), {}))
			.rejects.toThrow(new WebhookSignatureError({
				provider: 'mollie',
				reason: 'expected one "x-mollie-signature" header, got null',
			}));
	});

	test.each([
		['another secret', 'sha256='
			+ 'a16ebd6a5b9b79722fde7b48784a4007bba6b3d496f766c6ada1118dd986550b'],
		['uppercase hex', 'sha256='
			+ '11DA12AA76CB8250B01791F1BBB74DF86020069415B315EF4A2A3ECEC9A47BC3'],
		['no prefix',
			'11da12aa76cb8250b01791f1bbb74df86020069415b315ef4a2a3ecec9a47bc3'],
		['two values', 'sha256='
			+ '11da12aa76cb8250b01791f1bbb74df86020069415b315ef4a2a3ecec9a47bc3'
			+ ', sha256='
			+ '11da12aa76cb8250b01791f1bbb74df86020069415b315ef4a2a3ecec9a47bc3'],
	])('refuses a signature made with %s', async (_signatureCase, mollieSignature) => {
		await expect(createMollieProvider({} as MollieClient, ['mollie_secret_1'])
			.verifyWebhook(
				Buffer.from('{"type":"payment.paid","entityId":"tr_1"}'),
				{ 'x-mollie-signature': mollieSignature },
			))
			.rejects.toThrow(new WebhookSignatureError({
				provider: 'mollie',
				reason: 'the "x-mollie-signature" header does not sign the body',
			}));
	});

	test.each([
		[
			'{"type":"hook.ping"}',
			'015f250174f70e86721f87ae7e935122f6f5e377fbd3325e43b1ce5ee8e28eb9',
			'event type "hook.ping" names no payment',
		],
		[
			'{"type":"refund.refunded","entityId":"re_1"}',
			'6fe7a80755fc0a56c241dc5f438c0e7e3cfc8034ad8bd2f48e3a5779aaacd947',
			'event type "refund.refunded" names no payment',
		],
	])('ignores the signed event %s', async (
		eventBody,
		eventSignature,
		ignoredReason,
	) => {
		await expect(createMollieProvider({} as MollieClient, ['mollie_secret_1'])
			.verifyWebhook(
				Buffer.from(eventBody),
				{ 'x-mollie-signature': `sha256=${eventSignature}` },
			))
			.rejects.toThrow(new WebhookIgnoredError({
				provider: 'mollie',
				reason: ignoredReason,
			}));
	});

	test.each([
		[
			'id=tr_1',
			'312e3f5c2595dacf63aaa67cb23b354d8c4919c564a1070e8a6ade4b8bcfed9b',
			'the body is not JSON',
		],
		[
			'[]',
			'26095b5d4dae0ddf9f26b31229addcf164f8098fffacd78b2d79cbeda1d8e70f',
			'event type null is not a string',
		],
		[
			'{"entityId":"tr_1"}',
			'1e0ca7f57e4a12bbe93f842bf4d6914d07d01414720c4b7c865bbe062c7552c6',
			'event type null is not a string',
		],
		[
			'{"type":"payment.paid","entityId":"sub_1"}',
			'89690e297b0f8b0020ece46df58d67d1b936010547f444ff0fd1ef2051b932f3',
			'event entityId "sub_1" is not a payment id',
		],
	])('reads nothing from the signed body %s', async (
		eventBody,
		eventSignature,
		unreadableReason,
	) => {
		await expect(createMollieProvider({} as MollieClient, ['mollie_secret_1'])
			.verifyWebhook(
				Buffer.from(eventBody),
				{ 'x-mollie-signature': `sha256=${eventSignature}` },
			))
			.rejects.toThrow(new WebhookUnreadableError({
				provider: 'mollie',
				reason: unreadableReason,
			}));
	});
});

describe('fetchSubscription', () => {
	beforeEach(() => {
		vi.useFakeTimers({
			now: new Date('2026-11-20T00:00:00Z'),
			toFake: ['Date'],
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test.each([
		['2027-02-27T00:00:00Z', 'active'],
		['2027-02-28T10:00:00Z', 'canceled'],
	])(
		'reads a subscription canceled on 2027-02-28 as of %s as %s',
		async (readAt, storedStatus) => {
			vi.setSystemTime(new Date(readAt));

			await expect(createMollieProvider({
				customerSubscriptions: {
					get: vi.fn().mockResolvedValue({
						id: 'sub_1',
						customerId: 'cst_1',
						status: 'canceled',
						amount: { currency: 'EUR', value: '10.00' },
						interval: '1 month',
						startDate: '2027-02-28',
						metadata: { directus_subscription: '1' },
					}),
				},
				subscriptionPayments: {
					iterate: vi.fn().mockReturnValue({
						find: vi.fn().mockResolvedValue(undefined),
					}),
				},
			} as unknown as MollieClient)
				.fetchSubscription('cst_1/sub_1')).resolves.toEqual({
				subscriptionId: 'sub_1',
				customerId: 'cst_1',
				status: storedStatus,
				currentPeriodEnd: new Date('2027-02-28T00:00:00Z'),
				cancelAtPeriodEnd: true,
				directusSubscription: 1,
				billing: {
					amountCents: 1000,
					currency: 'EUR',
					interval: { months: 1, days: 0 },
				},
			});
		},
	);

	test('follows a payment id to its subscription', async () => {
		const mollieClient = {
			payments: {
				get: vi.fn().mockResolvedValue({
					id: 'tr_1',
					customerId: 'cst_1',
					subscriptionId: 'sub_1',
				}),
			},
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'active',
					amount: { currency: 'EUR', value: '10.00' },
					interval: '1 month',
					nextPaymentDate: '2026-12-01',
					metadata: { directus_subscription: '1' },
				}),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.fetchSubscription('tr_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
			status: 'active',
			currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
			cancelAtPeriodEnd: false,
			directusSubscription: 1,
			billing: {
				amountCents: 1000,
				currency: 'EUR',
				interval: { months: 1, days: 0 },
			},
		});

		expect(mollieClient.payments.get).toHaveBeenCalledWith('tr_1');

		expect(mollieClient.customerSubscriptions.get)
			.toHaveBeenCalledWith('sub_1', { customerId: 'cst_1' });
	});

	test('reports a payment Mollie does not know', async () => {
		const fetchFailure = await createMollieProvider({
			payments: {
				get: vi.fn().mockRejectedValue(
					new MollieApiError('Not found', { statusCode: 404 }),
				),
			},
		} as unknown as MollieClient)
			.fetchSubscription('tr_1')
			.catch((fetchError: unknown) => fetchError);

		expect(fetchFailure).toBeInstanceOf(MissingProviderSubscriptionError);

		expect(fetchFailure).toMatchObject({
			message: 'The provider has no subscription for "tr_1"',
			extensions: { resourceId: 'tr_1', subscriptionId: null },
		});
	});

	test('rethrows any other failure reading a payment', async () => {
		const unavailableError = new MollieApiError(
			'Unavailable',
			{ statusCode: 503 },
		);

		await expect(createMollieProvider({
			payments: { get: vi.fn().mockRejectedValue(unavailableError) },
		} as unknown as MollieClient)
			.fetchSubscription('tr_1')).rejects.toBe(unavailableError);
	});

	test.each([
		[{ id: 'tr_1', customerId: 'cst_1' }],
		[{ id: 'tr_1', subscriptionId: 'sub_1' }],
	])('reports a payment outside any subscription: %j', async (molliePayment) => {
		const fetchFailure = await createMollieProvider({
			payments: { get: vi.fn().mockResolvedValue(molliePayment) },
		} as unknown as MollieClient)
			.fetchSubscription('tr_1')
			.catch((fetchError: unknown) => fetchError);

		expect(fetchFailure).toBeInstanceOf(MissingProviderSubscriptionError);

		expect(fetchFailure).toMatchObject({
			message: 'The provider has no subscription for "tr_1"',
			extensions: { resourceId: 'tr_1', subscriptionId: null },
		});
	});

	test('reports a subscription Mollie does not have', async () => {
		const fetchFailure = await createMollieProvider({
			customerSubscriptions: {
				get: vi.fn().mockRejectedValue(
					new MollieApiError('Not found', { statusCode: 404 }),
				),
			},
		} as unknown as MollieClient)
			.fetchSubscription('cst_1/sub_1')
			.catch((fetchError: unknown) => fetchError);

		expect(fetchFailure).toBeInstanceOf(MissingProviderSubscriptionError);

		expect(fetchFailure).toMatchObject({
			message: 'The provider has no subscription for "cst_1/sub_1"',
			extensions: { resourceId: 'cst_1/sub_1', subscriptionId: 'sub_1' },
		});
	});

	test('reports a subscription of a deleted customer', async () => {
		const fetchFailure = await createMollieProvider({
			customerSubscriptions: {
				get: vi.fn().mockRejectedValue(
					new MollieApiError(
						'The customer is no longer available',
						{ statusCode: 410 },
					),
				),
			},
		} as unknown as MollieClient)
			.fetchSubscription('cst_1/sub_1')
			.catch((fetchError: unknown) => fetchError);

		expect(fetchFailure).toBeInstanceOf(MissingProviderSubscriptionError);

		expect(fetchFailure).toMatchObject({
			message: 'The provider has no subscription for "cst_1/sub_1"',
			extensions: { resourceId: 'cst_1/sub_1', subscriptionId: 'sub_1' },
		});
	});

	test('rethrows any other failure reading a subscription', async () => {
		const unavailableError = new MollieApiError(
			'Unavailable',
			{ statusCode: 503 },
		);

		await expect(createMollieProvider({
			customerSubscriptions: {
				get: vi.fn().mockRejectedValue(unavailableError),
			},
		} as unknown as MollieClient)
			.fetchSubscription('cst_1/sub_1')).rejects.toBe(unavailableError);
	});

	test('ends a period started on the 31st on the last day of February', async () => {
		await expect(createMollieProvider({
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'canceled',
					amount: { currency: 'EUR', value: '10.00' },
					interval: '1 month',
					metadata: { directus_subscription: '1' },
				}),
			},
			subscriptionPayments: {
				iterate: vi.fn().mockReturnValue({
					find: vi.fn().mockResolvedValue({
						status: 'paid',
						paidAt: '2027-01-31T10:00:00Z',
					}),
				}),
			},
		} as unknown as MollieClient)
			.fetchSubscription('cst_1/sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
			status: 'active',
			currentPeriodEnd: new Date('2027-02-28T10:00:00Z'),
			cancelAtPeriodEnd: true,
			directusSubscription: 1,
			billing: {
				amountCents: 1000,
				currency: 'EUR',
				interval: { months: 1, days: 0 },
			},
		});
	});

	test('ends a running subscription period at its next payment', async () => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'active',
					amount: { currency: 'EUR', value: '10.00' },
					interval: '1 month',
					nextPaymentDate: '2026-12-01',
					metadata: { directus_subscription: '1' },
				}),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.fetchSubscription('cst_1/sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
			status: 'active',
			currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
			cancelAtPeriodEnd: false,
			directusSubscription: 1,
			billing: {
				amountCents: 1000,
				currency: 'EUR',
				interval: { months: 1, days: 0 },
			},
		});

		expect(mollieClient.customerSubscriptions.get)
			.toHaveBeenCalledWith('sub_1', { customerId: 'cst_1' });
	});

	test(oneLine`
		ends a canceled period one month after the newest paid payment
	`, async () => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'canceled',
					amount: { currency: 'EUR', value: '10.00' },
					interval: '1 month',
					metadata: { directus_subscription: '1' },
				}),
			},
			subscriptionPayments: {
				iterate: vi.fn().mockReturnValue({
					find: (isWanted: (molliePayment: object) => boolean) => {
						return Promise.resolve([
							{ status: 'failed' },
							{ status: 'paid', paidAt: '2026-10-15T10:00:00Z' },
						].find(isWanted));
					},
				}),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.fetchSubscription('cst_1/sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
			status: 'canceled',
			currentPeriodEnd: new Date('2026-11-15T10:00:00Z'),
			cancelAtPeriodEnd: true,
			directusSubscription: 1,
			billing: {
				amountCents: 1000,
				currency: 'EUR',
				interval: { months: 1, days: 0 },
			},
		});

		expect(mollieClient.subscriptionPayments.iterate)
			.toHaveBeenCalledWith({ customerId: 'cst_1', subscriptionId: 'sub_1' });
	});

	test('adds weeks to the newest paid payment', async () => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'suspended',
					amount: { currency: 'EUR', value: '10.00' },
					interval: '2 weeks',
					metadata: { directus_subscription: '1' },
				}),
			},
			subscriptionPayments: {
				iterate: vi.fn().mockReturnValue({
					find: vi.fn().mockResolvedValue({
						status: 'paid',
						paidAt: '2026-10-15T10:00:00Z',
					}),
				}),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.fetchSubscription('cst_1/sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
			status: 'suspended',
			currentPeriodEnd: new Date('2026-10-29T10:00:00Z'),
			cancelAtPeriodEnd: false,
			directusSubscription: 1,
			billing: {
				amountCents: 1000,
				currency: 'EUR',
				interval: { months: 0, days: 14 },
			},
		});
	});

	test(oneLine`
		adds days to the newest paid payment of a completed subscription
	`, async () => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'completed',
					amount: { currency: 'EUR', value: '0.29' },
					interval: '10 days',
					metadata: { directus_subscription: '1' },
				}),
			},
			subscriptionPayments: {
				iterate: vi.fn().mockReturnValue({
					find: vi.fn().mockResolvedValue({
						status: 'paid',
						paidAt: '2026-10-15T10:00:00Z',
					}),
				}),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.fetchSubscription('cst_1/sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
			status: 'expired',
			currentPeriodEnd: new Date('2026-10-25T10:00:00Z'),
			cancelAtPeriodEnd: false,
			directusSubscription: 1,
			billing: {
				amountCents: 29,
				currency: 'EUR',
				interval: { months: 0, days: 10 },
			},
		});
	});

	test('reads a null next payment date as none', async () => {
		await expect(createMollieProvider({
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'canceled',
					amount: { currency: 'EUR', value: '10.00' },
					interval: '1 month',
					nextPaymentDate: null,
					metadata: { directus_subscription: '1' },
				}),
			},
			subscriptionPayments: {
				iterate: vi.fn().mockReturnValue({
					find: vi.fn().mockResolvedValue({
						status: 'paid',
						paidAt: '2026-10-15T10:00:00Z',
					}),
				}),
			},
		} as unknown as MollieClient)
			.fetchSubscription('cst_1/sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
			status: 'canceled',
			currentPeriodEnd: new Date('2026-11-15T10:00:00Z'),
			cancelAtPeriodEnd: true,
			directusSubscription: 1,
			billing: {
				amountCents: 1000,
				currency: 'EUR',
				interval: { months: 1, days: 0 },
			},
		});
	});

	test('ends at startDate when canceled before any charge', async () => {
		await expect(createMollieProvider({
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'canceled',
					amount: { currency: 'EUR', value: '10.00' },
					interval: '1 month',
					startDate: '2026-12-23',
					metadata: { directus_subscription: '1' },
				}),
			},
			subscriptionPayments: {
				iterate: vi.fn().mockReturnValue({
					find: vi.fn().mockResolvedValue(undefined),
				}),
			},
		} as unknown as MollieClient)
			.fetchSubscription('cst_1/sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
			status: 'active',
			currentPeriodEnd: new Date('2026-12-23T00:00:00Z'),
			cancelAtPeriodEnd: true,
			directusSubscription: 1,
			billing: {
				amountCents: 1000,
				currency: 'EUR',
				interval: { months: 1, days: 0 },
			},
		});
	});

	test('has no period end before any paid payment', async () => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'pending',
					amount: { currency: 'EUR', value: '10.00' },
					interval: '1 month',
					metadata: { directus_subscription: '1' },
				}),
			},
			subscriptionPayments: {
				iterate: vi.fn().mockReturnValue({
					find: vi.fn().mockResolvedValue(undefined),
				}),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.fetchSubscription('cst_1/sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
			status: 'pending',
			currentPeriodEnd: null,
			cancelAtPeriodEnd: false,
			directusSubscription: 1,
			billing: {
				amountCents: 1000,
				currency: 'EUR',
				interval: { months: 1, days: 0 },
			},
		});
	});

	test('refuses an interval it cannot read', async () => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'canceled',
					amount: { currency: 'EUR', value: '10.00' },
					interval: '1 fortnight',
					metadata: { directus_subscription: '1' },
				}),
			},
			subscriptionPayments: {
				iterate: vi.fn().mockReturnValue({
					find: vi.fn().mockResolvedValue({
						status: 'paid',
						paidAt: '2026-10-15T10:00:00Z',
					}),
				}),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.fetchSubscription('cst_1/sub_1')).rejects.toThrow(new Error(
			'Mollie interval "1 fortnight" is not "<count> months|weeks|days"',
		));
	});

	test('passes on a status it does not know', async () => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'on_hold',
					amount: { currency: 'EUR', value: '10.00' },
					interval: '1 month',
					nextPaymentDate: '2026-12-01',
					metadata: { directus_subscription: '1' },
				}),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.fetchSubscription('cst_1/sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
			status: 'on_hold',
			currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
			cancelAtPeriodEnd: false,
			directusSubscription: 1,
			billing: {
				amountCents: 1000,
				currency: 'EUR',
				interval: { months: 1, days: 0 },
			},
		});
	});

	test.each([
		[{ directus_subscription: 3 }],
		[{ directus_subscription: '0' }],
		[{ directus_subscription: '1a' }],
		[null],
		['monthly'],
	])('names no stored subscription on metadata %j', async (metadata) => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'suspended',
					amount: { currency: 'EUR', value: '10.00' },
					interval: '1 month',
					nextPaymentDate: '2026-12-01',
					metadata,
				}),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.fetchSubscription('cst_1/sub_1')).resolves.toMatchObject({
			status: 'suspended',
			directusSubscription: null,
		});
	});

	test('names the subscription it resumes', async () => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_2',
					customerId: 'cst_1',
					status: 'active',
					amount: { currency: 'EUR', value: '10.00' },
					interval: '1 month',
					nextPaymentDate: '2026-12-01',
					metadata: { directus_subscription: '1', resumes: 'sub_1' },
				}),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.fetchSubscription('cst_1/sub_2')).resolves.toEqual({
			subscriptionId: 'sub_2',
			customerId: 'cst_1',
			status: 'active',
			currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
			cancelAtPeriodEnd: false,
			directusSubscription: 1,
			billing: {
				amountCents: 1000,
				currency: 'EUR',
				interval: { months: 1, days: 0 },
			},
			resumedSubscriptionId: 'sub_1',
		});
	});

	test.each([
		['sub_1', 'Mollie resource id "sub_1" is not'],
		['cst_1/', 'Mollie resource id "cst_1/" is not'],
		['/sub_1', 'Mollie resource id "/sub_1" is not'],
		['cst_1/sub_1/extra', 'Mollie resource id "cst_1/sub_1/extra" is not'],
	])('refuses the resource id %j', async (resourceId, messageStart) => {
		await expect(createMollieProvider({} as MollieClient, ['mollie_secret_1'])
			.fetchSubscription(resourceId)).rejects.toThrow(new Error(
			`${messageStart} "<customer id>/<subscription id>"`,
		));
	});
});

describe('cancelAtPeriodEnd', () => {
	test('cancels the subscription at Mollie', async () => {
		const mollieClient = {
			customerSubscriptions: { cancel: vi.fn().mockResolvedValue({}) },
		};

		await createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.cancelAtPeriodEnd('cst_1/sub_1');

		// Fixed, so a retried cancel replays the first instead of failing on it.
		expect(mollieClient.customerSubscriptions.cancel)
			.toHaveBeenCalledWith('sub_1', {
				customerId: 'cst_1',
				idempotencyKey: 'cancel-sub_1',
			});
	});
});

describe('resumeCancel', () => {
	test(oneLine`
		starts a new subscription at the period end on the canceled one's mandate,
		without the classic webhook url Mollie would post unsigned
	`, async () => {
		const mollieClient = {
			customerSubscriptions: {
				iterate: vi.fn().mockReturnValue([
					{ id: 'sub_1', metadata: { directus_subscription: '1' } },
				]),
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					status: 'canceled',
					amount: { currency: 'EUR', value: '9.90' },
					interval: '1 month',
					description: 'Monthly',
					mandateId: 'mdt_2',
					times: null,
					timesRemaining: null,
					webhookUrl: 'https://example.com/subscriptions/webhooks/mollie',
					metadata: { directus_subscription: '1' },
				}),
				create: vi.fn().mockResolvedValue({ id: 'sub_2' }),
			},
			customerMandates: {
				iterate: vi.fn().mockReturnValue([
					{ id: 'mdt_1', status: 'valid' },
					{ id: 'mdt_2', status: 'valid' },
				]),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.resumeCancel({
				customerId: 'cst_1',
				subscriptionId: 'sub_1',
				periodEnd: new Date('2026-12-01T00:00:00Z'),
			})).resolves.toEqual({
			resourceId: 'cst_1/sub_2',
			isNewSubscription: true,
		});

		expect(mollieClient.customerSubscriptions.create).toHaveBeenCalledWith({
			customerId: 'cst_1',
			amount: { currency: 'EUR', value: '9.90' },
			interval: '1 month',
			description: 'Monthly',
			mandateId: 'mdt_2',
			startDate: '2026-12-01',
			metadata: { directus_subscription: '1', resumes: 'sub_1' },
			idempotencyKey: 'resume-sub_1',
		});
	});

	test(oneLine`
		resumes a fixed-term subscription with its remaining payments, on another
		valid mandate
	`, async () => {
		const mollieClient = {
			customerSubscriptions: {
				iterate: vi.fn().mockReturnValue([]),
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					status: 'canceled',
					amount: { currency: 'EUR', value: '9.90' },
					interval: '1 month',
					description: 'Monthly',
					mandateId: 'mdt_revoked',
					times: 12,
					timesRemaining: 4,
					webhookUrl: '',
					metadata: { directus_subscription: '1' },
				}),
				create: vi.fn().mockResolvedValue({ id: 'sub_2' }),
			},
			customerMandates: {
				iterate: vi.fn().mockReturnValue([
					{ id: 'mdt_revoked', status: 'invalid' },
					{ id: 'mdt_pending', status: 'pending' },
				]),
			},
		};

		await createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.resumeCancel({
				customerId: 'cst_1',
				subscriptionId: 'sub_1',
				periodEnd: new Date('2026-12-01T00:00:00Z'),
			});

		expect(mollieClient.customerSubscriptions.create).toHaveBeenCalledWith({
			customerId: 'cst_1',
			amount: { currency: 'EUR', value: '9.90' },
			interval: '1 month',
			description: 'Monthly',
			mandateId: 'mdt_pending',
			startDate: '2026-12-01',
			times: 4,
			metadata: { directus_subscription: '1', resumes: 'sub_1' },
			idempotencyKey: 'resume-sub_1',
		});
	});

	test('returns the subscription Mollie already holds resuming it', async () => {
		const mollieClient = {
			customerSubscriptions: {
				iterate: vi.fn().mockReturnValue([
					{ id: 'sub_1', metadata: { directus_subscription: '1' } },
					{
						id: 'sub_2',
						metadata: { directus_subscription: '1', resumes: 'sub_1' },
					},
				]),
				get: vi.fn(),
				create: vi.fn(),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.resumeCancel({
				customerId: 'cst_1',
				subscriptionId: 'sub_1',
				periodEnd: new Date('2026-12-01T00:00:00Z'),
			})).resolves.toEqual({
			resourceId: 'cst_1/sub_2',
			isNewSubscription: true,
		});

		expect(mollieClient.customerSubscriptions.iterate)
			.toHaveBeenCalledWith({ customerId: 'cst_1' });

		expect(mollieClient.customerSubscriptions.create).not.toHaveBeenCalled();
	});

	test(oneLine`
		starts another subscription past a canceled resume, keyed on its attempt
	`, async () => {
		const mollieClient = {
			customerSubscriptions: {
				iterate: vi.fn().mockReturnValue([
					{
						id: 'sub_1',
						status: 'canceled',
						metadata: { directus_subscription: '1' },
					},
					{
						id: 'sub_2',
						status: 'canceled',
						metadata: { directus_subscription: '1', resumes: 'sub_1' },
					},
				]),
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					status: 'canceled',
					amount: { currency: 'EUR', value: '9.90' },
					interval: '1 month',
					description: 'Monthly',
					mandateId: 'mdt_1',
					times: null,
					timesRemaining: null,
					metadata: { directus_subscription: '1' },
				}),
				create: vi.fn().mockResolvedValue({ id: 'sub_3' }),
			},
			customerMandates: {
				iterate: vi.fn().mockReturnValue([{ id: 'mdt_1', status: 'valid' }]),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.resumeCancel({
				customerId: 'cst_1',
				subscriptionId: 'sub_1',
				periodEnd: new Date('2026-12-01T00:00:00Z'),
			})).resolves.toEqual({
			resourceId: 'cst_1/sub_3',
			isNewSubscription: true,
		});

		expect(mollieClient.customerSubscriptions.create).toHaveBeenCalledWith({
			customerId: 'cst_1',
			amount: { currency: 'EUR', value: '9.90' },
			interval: '1 month',
			description: 'Monthly',
			mandateId: 'mdt_1',
			startDate: '2026-12-01',
			metadata: { directus_subscription: '1', resumes: 'sub_1' },
			idempotencyKey: 'resume-sub_1-2',
		});
	});

	test('refuses a customer without a valid mandate', async () => {
		const mollieClient = {
			customerSubscriptions: {
				iterate: vi.fn().mockReturnValue([]),
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					status: 'canceled',
					mandateId: 'mdt_1',
					metadata: { directus_subscription: '1' },
				}),
				create: vi.fn(),
			},
			customerMandates: {
				iterate: vi.fn().mockReturnValue([
					{ id: 'mdt_1', status: 'invalid' },
				]),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.resumeCancel({
				customerId: 'cst_1',
				subscriptionId: 'sub_1',
				periodEnd: new Date('2026-12-01T00:00:00Z'),
			})).rejects.toThrow(new NoValidMandateError({ customerId: 'cst_1' }));

		expect(mollieClient.customerMandates.iterate)
			.toHaveBeenCalledWith({ customerId: 'cst_1' });

		expect(mollieClient.customerSubscriptions.create).not.toHaveBeenCalled();
	});
});

describe('listInvoices', () => {
	test(oneLine`
		lists the subscription payments, then the checkout's first payment
	`, async () => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					metadata: { directus_subscription: '7' },
				}),
			},
			subscriptionPayments: {
				iterate: vi.fn().mockReturnValue([
					{
						id: 'tr_2',
						status: 'paid',
						amount: { currency: 'eur', value: '25.00' },
						createdAt: '2026-12-23T08:00:00+00:00',
						paidAt: '2026-12-23T08:05:00+00:00',
						subscriptionId: 'sub_1',
						sequenceType: 'recurring',
					},
				]),
			},
			customerPayments: {
				iterate: vi.fn().mockReturnValue([
					{
						id: 'tr_2',
						sequenceType: 'recurring',
						metadata: null,
					},
					{
						id: 'tr_other',
						sequenceType: 'first',
						metadata: { directus_subscription: '8' },
					},
					{
						id: 'tr_1',
						status: 'paid',
						amount: { currency: 'EUR', value: '25.00' },
						createdAt: '2026-11-23T10:00:00+00:00',
						paidAt: '2026-11-23T10:01:00+00:00',
						sequenceType: 'first',
						metadata: { directus_subscription: '7' },
					},
				]),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.listInvoices('cst_1/sub_1')).resolves.toEqual([
			{
				providerReference: 'tr_2',
				status: 'paid',
				amount: '25.00',
				currency: 'EUR',
				dateIssued: new Date('2026-12-23T08:00:00Z'),
				datePaid: new Date('2026-12-23T08:05:00Z'),
				hostedUrl: null,
				pdfUrl: null,
			},
			{
				providerReference: 'tr_1',
				status: 'paid',
				amount: '25.00',
				currency: 'EUR',
				dateIssued: new Date('2026-11-23T10:00:00Z'),
				datePaid: new Date('2026-11-23T10:01:00Z'),
				hostedUrl: null,
				pdfUrl: null,
			},
		]);

		expect(mollieClient.customerSubscriptions.get)
			.toHaveBeenCalledWith('sub_1', { customerId: 'cst_1' });

		expect(mollieClient.subscriptionPayments.iterate)
			.toHaveBeenCalledWith({ customerId: 'cst_1', subscriptionId: 'sub_1' });

		expect(mollieClient.customerPayments.iterate)
			.toHaveBeenCalledWith({ customerId: 'cst_1' });
	});

	test(oneLine`
		leaves a resume's first payment to the subscription it resumes
	`, async () => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_2',
					metadata: { directus_subscription: '7', resumes: 'sub_1' },
				}),
			},
			subscriptionPayments: {
				iterate: vi.fn().mockReturnValue([
					{
						id: 'tr_3',
						status: 'open',
						amount: { currency: 'EUR', value: '25.00' },
						createdAt: '2027-01-23T08:00:00+00:00',
					},
				]),
			},
			customerPayments: { iterate: vi.fn() },
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.listInvoices('cst_1/sub_2')).resolves.toEqual([
			{
				providerReference: 'tr_3',
				status: 'open',
				amount: '25.00',
				currency: 'EUR',
				dateIssued: new Date('2027-01-23T08:00:00Z'),
				datePaid: null,
				hostedUrl: null,
				pdfUrl: null,
			},
		]);

		expect(mollieClient.customerPayments.iterate).not.toHaveBeenCalled();
	});
});

describe('composeResourceId', () => {
	test('keys Mollie resources on the customer and subscription ids', () => {
		expect(createMollieProvider({} as MollieClient, ['mollie_secret_1'])
			.composeResourceId({ subscriptionId: 'sub_1', customerId: 'cst_1' }))
			.toBe('cst_1/sub_1');
	});
});

describe('createCheckout', () => {
	test('opens the first payment of a customer made for the checkout', async () => {
		const mollieClient = {
			customers: {
				create: vi.fn().mockResolvedValue({ id: 'cst_5' }),
			},
			payments: {
				create: vi.fn().mockResolvedValue({
					id: 'tr_5',
					getCheckoutUrl: () => 'https://www.mollie.com/checkout/tr_5',
				}),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.createCheckout({
				directusSubscription: 5,
				payerEmail: 'payer@example.com',
				amount: { currency: 'EUR', value: '14.90' },
				interval: { months: 1, days: 0 },
				planName: 'Pro',
				redirectUrl: 'https://shop.example.com/ok',
			}))
			.resolves.toBe('https://www.mollie.com/checkout/tr_5');

		expect(mollieClient.customers.create).toHaveBeenCalledWith({
			email: 'payer@example.com',
			metadata: { directus_subscription: '5' },
		});

		expect(mollieClient.payments.create).toHaveBeenCalledWith({
			amount: { currency: 'EUR', value: '14.90' },
			customerId: 'cst_5',
			sequenceType: 'first',
			description: 'Subscription 5',
			redirectUrl: 'https://shop.example.com/ok',
			metadata: { directus_subscription: '5' },
		});
	});

	test('refuses a payment without a checkout URL', async () => {
		await expect(createMollieProvider({
			customers: { create: vi.fn().mockResolvedValue({ id: 'cst_5' }) },
			payments: {
				create: vi.fn().mockResolvedValue({
					id: 'tr_5',
					getCheckoutUrl: () => null,
				}),
			},
		} as unknown as MollieClient)
			.createCheckout({
				directusSubscription: 5,
				payerEmail: 'payer@example.com',
				amount: { currency: 'EUR', value: '14.90' },
				interval: { months: 1, days: 0 },
				planName: 'Pro',
				redirectUrl: 'https://shop.example.com/ok',
			}))
			.rejects.toThrow('Mollie payment "tr_5" has no checkout URL');
	});
});

describe('startPaidCheckout', () => {
	test.each([
		[{ months: 1, days: 0 }, '1 month', '2026-12-05'],
		[{ months: 12, days: 0 }, '12 months', '2027-11-05'],
		[{ months: 0, days: 7 }, '1 week', '2026-11-12'],
		[{ months: 0, days: 14 }, '2 weeks', '2026-11-19'],
		[{ months: 0, days: 10 }, '10 days', '2026-11-15'],
	])(oneLine`
		bills a %j interval as "%s" on the paid mandate, from %s
	`, async (billingInterval, mollieInterval, startDate) => {
		const mollieClient = {
			customerSubscriptions: {
				iterate: vi.fn().mockReturnValue((async function* () {
					yield {
						id: 'sub_old',
						status: 'canceled',
						metadata: { directus_subscription: '5' },
					};

					yield {
						id: 'sub_other',
						status: 'active',
						metadata: { directus_subscription: '4' },
					};
				})()),
				create: vi.fn().mockResolvedValue({ id: 'sub_5' }),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.startPaidCheckout({
				paymentId: 'tr_5',
				customerId: 'cst_5',
				mandateId: 'mdt_5',
				paidAt: '2026-11-05T10:00:00+00:00',
				amount: { currency: 'EUR', value: '14.90' },
				directusSubscription: 5,
				interval: billingInterval,
			}))
			.resolves.toBe('cst_5/sub_5');

		expect(mollieClient.customerSubscriptions.iterate)
			.toHaveBeenCalledWith({ customerId: 'cst_5' });

		expect(mollieClient.customerSubscriptions.create).toHaveBeenCalledWith({
			customerId: 'cst_5',
			amount: { currency: 'EUR', value: '14.90' },
			interval: mollieInterval,
			description: 'Subscription 5',
			mandateId: 'mdt_5',
			startDate,
			metadata: { directus_subscription: '5' },
			idempotencyKey: 'checkout-tr_5',
		});
	});

	test('returns the subscription a lost commit already created', async () => {
		const mollieClient = {
			customerSubscriptions: {
				iterate: vi.fn().mockReturnValue((async function* () {
					yield {
						id: 'sub_5',
						status: 'active',
						metadata: { directus_subscription: '5' },
					};
				})()),
				create: vi.fn(),
			},
		};

		await expect(createMollieProvider(
			mollieClient as unknown as MollieClient,
			['mollie_secret_1'],
		)
			.startPaidCheckout({
				paymentId: 'tr_5',
				customerId: 'cst_5',
				mandateId: 'mdt_5',
				paidAt: '2026-11-05T10:00:00+00:00',
				amount: { currency: 'EUR', value: '14.90' },
				directusSubscription: 5,
				interval: { months: 1, days: 0 },
			}))
			.resolves.toBe('cst_5/sub_5');

		expect(mollieClient.customerSubscriptions.create).not.toHaveBeenCalled();
	});

	test.each([
		[{ months: 1, days: 3 }],
		[{ months: 0, days: 0 }],
	])('refuses a %j interval Mollie cannot bill', async (billingInterval) => {
		await expect(createMollieProvider({
			customerSubscriptions: {
				iterate: vi.fn().mockReturnValue((async function* () {})()),
			},
		} as unknown as MollieClient)
			.startPaidCheckout({
				paymentId: 'tr_5',
				customerId: 'cst_5',
				mandateId: 'mdt_5',
				paidAt: '2026-11-05T10:00:00+00:00',
				amount: { currency: 'EUR', value: '14.90' },
				directusSubscription: 5,
				interval: billingInterval,
			}))
			.rejects.toThrow(
				`Billing interval ${JSON.stringify(billingInterval)} is no`
				+ ' Mollie interval',
			);
	});
});

describe('fetchSubscription of a checkout payment', () => {
	test('hands a paid first payment over to start its subscription', async () => {
		const fetchFailure = await createMollieProvider({
			payments: {
				get: vi.fn().mockResolvedValue({
					id: 'tr_5',
					status: 'paid',
					sequenceType: 'first',
					customerId: 'cst_5',
					mandateId: 'mdt_5',
					paidAt: '2026-11-05T10:00:00+00:00',
					amount: { currency: 'EUR', value: '14.90' },
					metadata: { directus_subscription: '5' },
				}),
			},
		} as unknown as MollieClient)
			.fetchSubscription('tr_5')
			.catch((fetchError: unknown) => fetchError);

		expect(fetchFailure).toBeInstanceOf(PaidCheckoutError);

		expect(fetchFailure).toMatchObject({
			message: oneLine`
				Payment "tr_5" paid the checkout of subscription 5, which has no
				provider subscription yet
			`,
			extensions: {
				paymentId: 'tr_5',
				customerId: 'cst_5',
				mandateId: 'mdt_5',
				paidAt: '2026-11-05T10:00:00+00:00',
				amount: { currency: 'EUR', value: '14.90' },
				directusSubscription: 5,
			},
		});
	});

	test.each(['expired', 'failed', 'canceled'])(
		'reports a first payment %s as an abandoned checkout',
		async (paymentStatus) => {
			const fetchFailure = await createMollieProvider({
				payments: {
					get: vi.fn().mockResolvedValue({
						id: 'tr_5',
						status: paymentStatus,
						sequenceType: 'first',
						customerId: 'cst_5',
						amount: { currency: 'EUR', value: '14.90' },
						metadata: { directus_subscription: '5' },
					}),
				},
			} as unknown as MollieClient)
				.fetchSubscription('tr_5')
				.catch((fetchError: unknown) => fetchError);

			expect(fetchFailure).toBeInstanceOf(AbandonedCheckoutError);

			expect(fetchFailure).toMatchObject({
				message: `Checkout "tr_5" of subscription 5 ended`
					+ ` ${JSON.stringify(paymentStatus)}, unpaid`,
				extensions: {
					checkoutId: 'tr_5',
					checkoutStatus: paymentStatus,
					directusSubscription: 5,
				},
			});
		},
	);

	test.each([
		[{ status: 'open' }],
		[{ status: 'paid' }],
		[{ status: 'paid', sequenceType: 'recurring' }],
		[{ status: 'paid', metadata: null }],
	])('reports a first payment %j as no subscription yet', async (paymentFields) => {
		const fetchFailure = await createMollieProvider({
			payments: {
				get: vi.fn().mockResolvedValue({
					id: 'tr_5',
					sequenceType: 'first',
					customerId: 'cst_5',
					amount: { currency: 'EUR', value: '14.90' },
					metadata: { directus_subscription: '5' },
					...paymentFields,
				}),
			},
		} as unknown as MollieClient)
			.fetchSubscription('tr_5')
			.catch((fetchError: unknown) => fetchError);

		expect(fetchFailure).toBeInstanceOf(MissingProviderSubscriptionError);

		expect(fetchFailure).toMatchObject({
			message: 'The provider has no subscription for "tr_5"',
			extensions: { resourceId: 'tr_5', subscriptionId: null },
		});
	});
});
