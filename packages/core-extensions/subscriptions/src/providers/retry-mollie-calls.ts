import { MollieApiError } from '@mollie/api-client';
import { setTimeout as waitTimeout } from 'node:timers/promises';
import type { SubscriptionProvider } from './types.js';

export type MollieRetrySettings = { maxRetries: number; delayMs: number };

/**
 * The client retries a 5xx itself, but neither a 429 nor a network failure,
 * and drops a 429's headers: its Retry-After is out of reach, so the wait
 * grows by `delayMs` with each attempt instead.
 */
export async function retryMollieCall<CallAnswer>(
	retrySettings: MollieRetrySettings,
	mollieCall: () => Promise<CallAnswer>,
	waitRetryDelay: (delayMs: number) => Promise<unknown> = waitTimeout,
): Promise<CallAnswer> {
	for (let retryCount = 0; ; retryCount++) {
		try {
			return await mollieCall();
		}
		catch (callError) {
			const isRetryable = callError instanceof MollieApiError
				&& (callError.statusCode === 429
					|| (callError.statusCode === undefined
						&& isRefusedBeforeCall(callError) === false));

			if (isRetryable === false || retryCount >= retrySettings.maxRetries) {
				throw callError;
			}

			await waitRetryDelay(retrySettings.delayMs * (retryCount + 1));
		}
	}
}

/**
 * The client checks an id's shape before any request and throws an ApiError
 * with no status, like a network failure; a retry would refuse it again.
 */
function isRefusedBeforeCall(callError: MollieApiError): boolean {
	return / id appears invalid: .* \(unexpected format\)$/.test(callError.message);
}

export function retryMollieProvider(
	mollieProvider: SubscriptionProvider,
	retrySettings: MollieRetrySettings,
): SubscriptionProvider {
	return {
		...mollieProvider,
		fetchSubscription: (resourceId) => {
			return retryMollieCall(
				retrySettings,
				() => mollieProvider.fetchSubscription(resourceId),
			);
		},
		cancelAtPeriodEnd: (resourceId) => {
			return retryMollieCall(
				retrySettings,
				() => mollieProvider.cancelAtPeriodEnd(resourceId),
			);
		},
		resumeCancel: (cancelResume) => {
			return retryMollieCall(
				retrySettings,
				() => mollieProvider.resumeCancel(cancelResume),
			);
		},
	};
}
