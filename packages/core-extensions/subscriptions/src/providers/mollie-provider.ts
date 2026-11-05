import { MollieApiError, type MollieClient } from '@mollie/api-client';
import { WebhookRefusedError } from '../errors.js';
import type { ProviderSubscriptionIds, SubscriptionProvider } from './types.js';

/** The fields read off Mollie's Subscription, which the client does not export. */
type MollieSubscription = {
	id: string;
	customerId: string;
	interval: string;
	nextPaymentDate?: string | null;
	metadata: unknown;
};

const MOLLIE_PAYMENT_ID = /^tr_\w+$/;

const MOLLIE_INTERVAL = /^(\d+) (month|week|day)s?$/;

/** Mollie's `completed` is a fixed-term subscription past its last payment. */
const NORMALIZED_STATUSES: Record<string, string> = {
	pending: 'pending',
	active: 'active',
	canceled: 'canceled',
	suspended: 'suspended',
	completed: 'expired',
};

export function createMollieProvider(
	mollieClient: MollieClient,
): SubscriptionProvider {
	return {
		async verifyWebhook(rawBody) {
			const paymentId = new URLSearchParams(rawBody.toString('utf8'))
				.get('id');

			if (paymentId === null || !MOLLIE_PAYMENT_ID.test(paymentId)) {
				throw new WebhookRefusedError({
					provider: 'mollie',
					reason: `body id ${JSON.stringify(paymentId)} is not a payment id`,
				});
			}

			const molliePayment = await fetchWebhookPayment(
				mollieClient,
				paymentId,
			);

			if (molliePayment.subscriptionId === undefined
				|| molliePayment.customerId === undefined) {
				throw new WebhookRefusedError({
					provider: 'mollie',
					reason: `payment ${JSON.stringify(paymentId)}`
						+ ' belongs to no subscription',
				});
			}

			return composeMollieResourceId({
				subscriptionId: molliePayment.subscriptionId,
				customerId: molliePayment.customerId,
			});
		},

		async fetchSubscription(resourceId) {
			const { customerId, subscriptionId } = parseMollieResourceId(resourceId);

			const mollieSubscription = await mollieClient.customerSubscriptions
				.get(subscriptionId, { customerId });

			const normalizedStatus = NORMALIZED_STATUSES[mollieSubscription.status];

			if (normalizedStatus === undefined) {
				throw new Error(
					`Mollie subscription ${JSON.stringify(resourceId)} has unknown`
					+ ` status ${JSON.stringify(mollieSubscription.status)}`,
				);
			}

			return {
				subscriptionId,
				customerId,
				status: normalizedStatus,
				currentPeriodEnd: await readPeriodEnd(
					mollieClient,
					mollieSubscription,
				),
				cancelAtPeriodEnd: mollieSubscription.status === 'canceled',
				planReference: readPlanReference(resourceId, mollieSubscription),
			};
		},

		async cancelAtPeriodEnd(resourceId) {
			const { customerId, subscriptionId } = parseMollieResourceId(resourceId);

			await mollieClient.customerSubscriptions.cancel(
				subscriptionId,
				{ customerId },
			);
		},

		composeResourceId: composeMollieResourceId,
	};
}

function composeMollieResourceId({
	subscriptionId,
	customerId,
}: ProviderSubscriptionIds): string {
	return `${customerId}/${subscriptionId}`;
}

function parseMollieResourceId(resourceId: string): ProviderSubscriptionIds {
	const [customerId, subscriptionId, ...extraParts] = resourceId.split('/');

	if (customerId === undefined
		|| subscriptionId === undefined
		|| customerId === ''
		|| subscriptionId === ''
		|| extraParts.length > 0) {
		throw new Error(
			`Mollie resource id ${JSON.stringify(resourceId)} is not`
			+ ' "<customer id>/<subscription id>"',
		);
	}

	return { customerId, subscriptionId };
}

async function fetchWebhookPayment(
	mollieClient: MollieClient,
	paymentId: string,
) {
	try {
		return await mollieClient.payments.get(paymentId);
	}
	catch (error) {
		if (error instanceof MollieApiError && error.statusCode === 404) {
			throw new WebhookRefusedError(
				{
					provider: 'mollie',
					reason: `payment ${JSON.stringify(paymentId)} does not exist`,
				},
				{ cause: error },
			);
		}

		throw error;
	}
}

/**
 * Mollie has no period end: the next payment date while the subscription
 * runs, else the newest paid payment plus one interval.
 */
async function readPeriodEnd(
	mollieClient: MollieClient,
	mollieSubscription: MollieSubscription,
): Promise<Date | null> {
	if (typeof mollieSubscription.nextPaymentDate === 'string') {
		return new Date(`${mollieSubscription.nextPaymentDate}T00:00:00Z`);
	}

	const newestPaidPayment = await mollieClient.subscriptionPayments
		.iterate({
			customerId: mollieSubscription.customerId,
			subscriptionId: mollieSubscription.id,
		})
		.find((molliePayment) => molliePayment.status === 'paid');

	if (newestPaidPayment?.paidAt === undefined) {
		return null;
	}

	return addMollieInterval(
		new Date(newestPaidPayment.paidAt),
		mollieSubscription.interval,
	);
}

function addMollieInterval(startDate: Date, mollieInterval: string): Date {
	const intervalMatch = MOLLIE_INTERVAL.exec(mollieInterval);

	if (intervalMatch === null) {
		throw new Error(
			`Mollie interval ${JSON.stringify(mollieInterval)} is not`
			+ ' "<count> months|weeks|days"',
		);
	}

	const intervalCount = Number(intervalMatch[1]);
	const endDate = new Date(startDate);

	if (intervalMatch[2] === 'month') {
		endDate.setUTCMonth(endDate.getUTCMonth() + intervalCount);
	}
	else if (intervalMatch[2] === 'week') {
		endDate.setUTCDate(endDate.getUTCDate() + 7 * intervalCount);
	}
	else {
		endDate.setUTCDate(endDate.getUTCDate() + intervalCount);
	}

	return endDate;
}

function readPlanReference(
	resourceId: string,
	mollieSubscription: MollieSubscription,
): string {
	const subscriptionMetadata = mollieSubscription.metadata;

	const planReference = typeof subscriptionMetadata === 'object'
		&& subscriptionMetadata !== null
		? (subscriptionMetadata as Record<string, unknown>)['plan']
		: undefined;

	if (typeof planReference !== 'string') {
		throw new Error(
			`Mollie subscription ${JSON.stringify(resourceId)} metadata`
			+ ` ${JSON.stringify(subscriptionMetadata)} has no string "plan"`,
		);
	}

	return planReference;
}
