import { MollieApiError, type MollieClient } from '@mollie/api-client';
import {
	MissingProviderSubscriptionError,
	WebhookRefusedError,
} from '../errors.js';
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

			// Mollie signs nothing, so the id is a hint for the sync worker to
			// check: calling Mollie here would let a flood spend our API key.
			return paymentId;
		},

		async fetchSubscription(resourceId) {
			const { customerId, subscriptionId } = MOLLIE_PAYMENT_ID.test(resourceId)
				? await readPaymentSubscription(mollieClient, resourceId)
				: parseMollieResourceId(resourceId);

			const mollieSubscription = await getMollieSubscription(
				mollieClient,
				resourceId,
				{ customerId, subscriptionId },
			);

			return {
				subscriptionId,
				customerId,
				status: NORMALIZED_STATUSES[mollieSubscription.status]
					?? mollieSubscription.status,
				currentPeriodEnd: await readPeriodEnd(
					mollieClient,
					mollieSubscription,
				),
				cancelAtPeriodEnd: mollieSubscription.status === 'canceled',
				planReference: readPlanReference(mollieSubscription),
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

/**
 * The first payment, which sets up the mandate, carries no subscriptionId: its
 * webhook grants nothing, access starts with the subscription's first charge.
 */
async function readPaymentSubscription(
	mollieClient: MollieClient,
	paymentId: string,
): Promise<ProviderSubscriptionIds> {
	const molliePayment = await mollieClient.payments.get(paymentId)
		.catch((error: unknown) => {
			throw mapMollieNotFound(error, paymentId, null);
		});

	if (molliePayment.subscriptionId === undefined
		|| molliePayment.customerId === undefined) {
		throw new MissingProviderSubscriptionError({
			resourceId: paymentId,
			subscriptionId: null,
		});
	}

	return {
		customerId: molliePayment.customerId,
		subscriptionId: molliePayment.subscriptionId,
	};
}

async function getMollieSubscription(
	mollieClient: MollieClient,
	resourceId: string,
	{ customerId, subscriptionId }: ProviderSubscriptionIds,
) {
	return await mollieClient.customerSubscriptions
		.get(subscriptionId, { customerId })
		.catch((error: unknown) => {
			throw mapMollieNotFound(error, resourceId, subscriptionId);
		});
}

function mapMollieNotFound(
	mollieError: unknown,
	resourceId: string,
	subscriptionId: string | null,
): unknown {
	return mollieError instanceof MollieApiError
		&& mollieError.statusCode === 404
		? new MissingProviderSubscriptionError(
			{ resourceId, subscriptionId },
			{ cause: mollieError },
		)
		: mollieError;
}

/**
 * Mollie has no period end: the next payment date while the subscription
 * runs, else the newest paid payment plus one interval. A subscription canceled
 * before its first charge has none: null, so its access ends at once.
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

		// Jan 31 rolled over to March: a paid month ends on the last day of Feb.
		if (endDate.getUTCDate() !== startDate.getUTCDate()) {
			endDate.setUTCDate(0);
		}
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
	mollieSubscription: MollieSubscription,
): string | null {
	const subscriptionMetadata = mollieSubscription.metadata;

	const planReference = typeof subscriptionMetadata === 'object'
		&& subscriptionMetadata !== null
		? (subscriptionMetadata as Record<string, unknown>)['plan']
		: undefined;

	return typeof planReference === 'string'
		? planReference
		: null;
}
