import { MollieApiError } from '@mollie/api-client';
import { describe, expect, test, vi } from 'vitest';
import { MissingProviderSubscriptionError } from '../errors.js';
import { retryMollieCall, retryMollieProvider } from './retry-mollie-calls.js';
import type { SubscriptionProvider } from './types.js';

describe('retryMollieCall', () => {
	test('answers what the call answers, without waiting', async () => {
		const waitRetryDelay = vi.fn();

		await expect(retryMollieCall(
			{ maxRetries: 3, delayMs: 1000 },
			vi.fn().mockResolvedValue('answer'),
			waitRetryDelay,
		))
			.resolves.toBe('answer');

		expect(waitRetryDelay).not.toHaveBeenCalled();
	});

	test('retries a 429, waiting longer each time', async () => {
		const mollieCall = vi.fn()
			.mockRejectedValueOnce(new MollieApiError('Too many', { statusCode: 429 }))
			.mockRejectedValueOnce(new MollieApiError('Too many', { statusCode: 429 }))
			.mockResolvedValue('answer');

		const waitRetryDelay = vi.fn().mockResolvedValue(undefined);

		await expect(retryMollieCall(
			{ maxRetries: 3, delayMs: 1000 },
			mollieCall,
			waitRetryDelay,
		))
			.resolves.toBe('answer');

		expect(mollieCall).toHaveBeenCalledTimes(3);
		expect(waitRetryDelay.mock.calls).toEqual([[1000], [2000]]);
	});

	test('retries a network failure, which carries no status', async () => {
		const mollieCall = vi.fn()
			.mockRejectedValueOnce(new MollieApiError('socket hang up'))
			.mockResolvedValue('answer');

		await expect(retryMollieCall(
			{ maxRetries: 1, delayMs: 0 },
			mollieCall,
			vi.fn().mockResolvedValue(undefined),
		))
			.resolves.toBe('answer');

		expect(mollieCall).toHaveBeenCalledTimes(2);
	});

	test('rethrows the last 429 once the retries are spent', async () => {
		const mollieCall = vi.fn()
			.mockRejectedValue(new MollieApiError('Too many', { statusCode: 429 }));

		await expect(retryMollieCall(
			{ maxRetries: 2, delayMs: 0 },
			mollieCall,
			vi.fn().mockResolvedValue(undefined),
		))
			.rejects.toThrow(new MollieApiError('Too many', { statusCode: 429 }));

		expect(mollieCall).toHaveBeenCalledTimes(3);
	});

	test('calls once with no retry set', async () => {
		const mollieCall = vi.fn()
			.mockRejectedValue(new MollieApiError('Too many', { statusCode: 429 }));

		await expect(retryMollieCall(
			{ maxRetries: 0, delayMs: 1000 },
			mollieCall,
			vi.fn().mockResolvedValue(undefined),
		))
			.rejects.toThrow(new MollieApiError('Too many', { statusCode: 429 }));

		expect(mollieCall).toHaveBeenCalledTimes(1);
	});

	test.each([
		['a 422', new MollieApiError('Unprocessable', { statusCode: 422 })],
		['a 5xx the client already retried',
			new MollieApiError('Bad gateway', { statusCode: 502 })],
		['a missing subscription', new MissingProviderSubscriptionError({
			resourceId: 'tr_1',
			subscriptionId: null,
		})],
		['any other error', new Error('boom')],
	])('rethrows %s at once', async (_errorCase, callError) => {
		const mollieCall = vi.fn().mockRejectedValue(callError);

		await expect(retryMollieCall(
			{ maxRetries: 3, delayMs: 0 },
			mollieCall,
			vi.fn().mockResolvedValue(undefined),
		))
			.rejects.toBe(callError);

		expect(mollieCall).toHaveBeenCalledTimes(1);
	});
});

describe('retryMollieProvider', () => {
	test('retries each call to Mollie, and only those', async () => {
		const tooManyRequests = new MollieApiError('Too many', { statusCode: 429 });

		const mollieProvider = {
			verifyWebhook: vi.fn().mockResolvedValue('tr_1'),
			fetchSubscription: vi.fn()
				.mockRejectedValueOnce(tooManyRequests)
				.mockResolvedValue('fetched'),
			cancelAtPeriodEnd: vi.fn()
				.mockRejectedValueOnce(tooManyRequests)
				.mockResolvedValue(undefined),
			resumeCancel: vi.fn()
				.mockRejectedValueOnce(tooManyRequests)
				.mockResolvedValue('resumed'),
			composeResourceId: vi.fn().mockReturnValue('cst_1/sub_1'),
		};

		const retriedProvider = retryMollieProvider(
			mollieProvider as unknown as SubscriptionProvider,
			{ maxRetries: 1, delayMs: 0 },
		);

		await expect(retriedProvider.fetchSubscription('tr_1'))
			.resolves.toBe('fetched');

		await expect(retriedProvider.cancelAtPeriodEnd('cst_1/sub_1'))
			.resolves.toBeUndefined();

		await expect(retriedProvider.resumeCancel({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
			periodEnd: new Date('2026-12-01T00:00:00Z'),
		}))
			.resolves.toBe('resumed');

		expect(retriedProvider.composeResourceId({
			subscriptionId: 'sub_1',
			customerId: 'cst_1',
		}))
			.toBe('cst_1/sub_1');

		expect(mollieProvider.fetchSubscription.mock.calls)
			.toEqual([['tr_1'], ['tr_1']]);

		expect(mollieProvider.cancelAtPeriodEnd.mock.calls)
			.toEqual([['cst_1/sub_1'], ['cst_1/sub_1']]);

		expect(mollieProvider.resumeCancel.mock.calls).toEqual([
			[{
				subscriptionId: 'sub_1',
				customerId: 'cst_1',
				periodEnd: new Date('2026-12-01T00:00:00Z'),
			}],
			[{
				subscriptionId: 'sub_1',
				customerId: 'cst_1',
				periodEnd: new Date('2026-12-01T00:00:00Z'),
			}],
		]);

		expect(retriedProvider.verifyWebhook).toBe(mollieProvider.verifyWebhook);
	});
});
