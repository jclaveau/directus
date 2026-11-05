import { oneLine } from '@directus/utils';
import { MollieApiError, type MollieClient } from '@mollie/api-client';
import { describe, expect, test, vi } from 'vitest';
import { WebhookRefusedError } from '../errors.js';
import { createMollieProvider } from './mollie-provider.js';

describe('verifyWebhook', () => {
	test('resolves a subscription payment to its resource id', async () => {
		const mollieClient = {
			payments: {
				get: vi.fn().mockResolvedValue({
					id: 'tr_1',
					customerId: 'cst_1',
					subscriptionId: 'sub_1',
				}),
			},
		};

		await expect(createMollieProvider(mollieClient as unknown as MollieClient)
			.verifyWebhook(Buffer.from('id=tr_1'), {}))
			.resolves.toBe('cst_1/sub_1');

		expect(mollieClient.payments.get).toHaveBeenCalledWith('tr_1');
	});

	test('refuses a body without an id', async () => {
		await expect(createMollieProvider({} as MollieClient)
			.verifyWebhook(Buffer.from('foo=bar'), {}))
			.rejects.toThrow(new WebhookRefusedError({
				provider: 'mollie',
				reason: 'body id null is not a payment id',
			}));
	});

	test('refuses an id that is no payment id', async () => {
		await expect(createMollieProvider({} as MollieClient)
			.verifyWebhook(Buffer.from('id=sub_1'), {}))
			.rejects.toThrow(new WebhookRefusedError({
				provider: 'mollie',
				reason: 'body id "sub_1" is not a payment id',
			}));
	});

	test('refuses a payment Mollie does not know', async () => {
		const mollieClient = {
			payments: {
				get: vi.fn().mockRejectedValue(
					new MollieApiError('Not found', { statusCode: 404 }),
				),
			},
		};

		await expect(createMollieProvider(mollieClient as unknown as MollieClient)
			.verifyWebhook(Buffer.from('id=tr_1'), {}))
			.rejects.toThrow(new WebhookRefusedError({
				provider: 'mollie',
				reason: 'payment "tr_1" does not exist',
			}));
	});

	test('rethrows any other Mollie failure', async () => {
		const mollieClient = {
			payments: {
				get: vi.fn().mockRejectedValue(
					new MollieApiError('Unavailable', { statusCode: 503 }),
				),
			},
		};

		await expect(createMollieProvider(mollieClient as unknown as MollieClient)
			.verifyWebhook(Buffer.from('id=tr_1'), {}))
			.rejects.toThrow(
				new MollieApiError('Unavailable', { statusCode: 503 }),
			);
	});

	test('refuses a payment outside any subscription', async () => {
		const mollieClient = {
			payments: {
				get: vi.fn().mockResolvedValue({ id: 'tr_1', customerId: 'cst_1' }),
			},
		};

		await expect(createMollieProvider(mollieClient as unknown as MollieClient)
			.verifyWebhook(Buffer.from('id=tr_1'), {}))
			.rejects.toThrow(new WebhookRefusedError({
				provider: 'mollie',
				reason: 'payment "tr_1" belongs to no subscription',
			}));
	});

	test('refuses a payment without a customer', async () => {
		const mollieClient = {
			payments: {
				get: vi.fn().mockResolvedValue({ id: 'tr_1', subscriptionId: 'sub_1' }),
			},
		};

		await expect(createMollieProvider(mollieClient as unknown as MollieClient)
			.verifyWebhook(Buffer.from('id=tr_1'), {}))
			.rejects.toThrow(new WebhookRefusedError({
				provider: 'mollie',
				reason: 'payment "tr_1" belongs to no subscription',
			}));
	});
});

describe('fetchSubscription', () => {
	test('ends a running subscription period at its next payment', async () => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'active',
					interval: '1 month',
					nextPaymentDate: '2026-12-01',
					metadata: { plan: 'monthly' },
				}),
			},
		};

		await expect(createMollieProvider(mollieClient as unknown as MollieClient)
			.fetchSubscription('cst_1/sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
			status: 'active',
			currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
			cancelAtPeriodEnd: false,
			planReference: 'monthly',
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
					interval: '1 month',
					metadata: { plan: 'monthly' },
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

		await expect(createMollieProvider(mollieClient as unknown as MollieClient)
			.fetchSubscription('cst_1/sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
			status: 'canceled',
			currentPeriodEnd: new Date('2026-11-15T10:00:00Z'),
			cancelAtPeriodEnd: true,
			planReference: 'monthly',
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
					interval: '2 weeks',
					metadata: { plan: 'fortnightly' },
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

		await expect(createMollieProvider(mollieClient as unknown as MollieClient)
			.fetchSubscription('cst_1/sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
			status: 'suspended',
			currentPeriodEnd: new Date('2026-10-29T10:00:00Z'),
			cancelAtPeriodEnd: false,
			planReference: 'fortnightly',
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
					interval: '10 days',
					metadata: { plan: 'trial' },
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

		await expect(createMollieProvider(mollieClient as unknown as MollieClient)
			.fetchSubscription('cst_1/sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
			status: 'expired',
			currentPeriodEnd: new Date('2026-10-25T10:00:00Z'),
			cancelAtPeriodEnd: false,
			planReference: 'trial',
		});
	});

	test('reads a null next payment date as none', async () => {
		await expect(createMollieProvider({
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'canceled',
					interval: '1 month',
					nextPaymentDate: null,
					metadata: { plan: 'monthly' },
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
			planReference: 'monthly',
		});
	});

	test('has no period end before any paid payment', async () => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'pending',
					interval: '1 month',
					metadata: { plan: 'monthly' },
				}),
			},
			subscriptionPayments: {
				iterate: vi.fn().mockReturnValue({
					find: vi.fn().mockResolvedValue(undefined),
				}),
			},
		};

		await expect(createMollieProvider(mollieClient as unknown as MollieClient)
			.fetchSubscription('cst_1/sub_1')).resolves.toEqual({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
			status: 'pending',
			currentPeriodEnd: null,
			cancelAtPeriodEnd: false,
			planReference: 'monthly',
		});
	});

	test('refuses an interval it cannot read', async () => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'canceled',
					interval: '1 fortnight',
					metadata: { plan: 'monthly' },
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

		await expect(createMollieProvider(mollieClient as unknown as MollieClient)
			.fetchSubscription('cst_1/sub_1')).rejects.toThrow(new Error(
			'Mollie interval "1 fortnight" is not "<count> months|weeks|days"',
		));
	});

	test('refuses a status it does not know', async () => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'paused',
					interval: '1 month',
					metadata: { plan: 'monthly' },
				}),
			},
		};

		await expect(createMollieProvider(mollieClient as unknown as MollieClient)
			.fetchSubscription('cst_1/sub_1')).rejects.toThrow(new Error(
			'Mollie subscription "cst_1/sub_1" has unknown status "paused"',
		));
	});

	test('refuses metadata without a plan', async () => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'active',
					interval: '1 month',
					nextPaymentDate: '2026-12-01',
					metadata: { plan: 3 },
				}),
			},
		};

		await expect(createMollieProvider(mollieClient as unknown as MollieClient)
			.fetchSubscription('cst_1/sub_1')).rejects.toThrow(new Error(
			'Mollie subscription "cst_1/sub_1" metadata {"plan":3}'
			+ ' has no string "plan"',
		));
	});

	test('refuses null metadata', async () => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'active',
					interval: '1 month',
					nextPaymentDate: '2026-12-01',
					metadata: null,
				}),
			},
		};

		await expect(createMollieProvider(mollieClient as unknown as MollieClient)
			.fetchSubscription('cst_1/sub_1')).rejects.toThrow(new Error(
			'Mollie subscription "cst_1/sub_1" metadata null has no string "plan"',
		));
	});

	test('refuses string metadata', async () => {
		const mollieClient = {
			customerSubscriptions: {
				get: vi.fn().mockResolvedValue({
					id: 'sub_1',
					customerId: 'cst_1',
					status: 'active',
					interval: '1 month',
					nextPaymentDate: '2026-12-01',
					metadata: 'monthly',
				}),
			},
		};

		await expect(createMollieProvider(mollieClient as unknown as MollieClient)
			.fetchSubscription('cst_1/sub_1')).rejects.toThrow(new Error(
			'Mollie subscription "cst_1/sub_1" metadata "monthly"'
			+ ' has no string "plan"',
		));
	});

	test.each([
		['sub_1', 'Mollie resource id "sub_1" is not'],
		['cst_1/', 'Mollie resource id "cst_1/" is not'],
		['/sub_1', 'Mollie resource id "/sub_1" is not'],
		['cst_1/sub_1/extra', 'Mollie resource id "cst_1/sub_1/extra" is not'],
	])('refuses the resource id %j', async (resourceId, messageStart) => {
		await expect(createMollieProvider({} as MollieClient)
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

		await createMollieProvider(mollieClient as unknown as MollieClient)
			.cancelAtPeriodEnd('cst_1/sub_1');

		expect(mollieClient.customerSubscriptions.cancel)
			.toHaveBeenCalledWith('sub_1', { customerId: 'cst_1' });
	});
});

describe('composeResourceId', () => {
	test('keys Mollie resources on the customer and subscription ids', () => {
		expect(createMollieProvider({} as MollieClient)
			.composeResourceId({ subscriptionId: 'sub_1', customerId: 'cst_1' }))
			.toBe('cst_1/sub_1');
	});
});
