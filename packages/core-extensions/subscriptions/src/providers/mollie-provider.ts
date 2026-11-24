import {
	MollieApiError,
	type MollieClient,
	SequenceType,
} from '@mollie/api-client';
import type { IncomingHttpHeaders } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
	AbandonedCheckoutError,
	MissingProviderSubscriptionError,
	NoValidMandateError,
	PaidCheckoutError,
	ProviderUnavailableError,
	WebhookIgnoredError,
	WebhookSignatureError,
	WebhookUnreadableError,
} from '../errors.js';
import type { MollieSessionCreator } from './create-mollie-session.js';
import { readDirectusSubscription } from './read-directus-subscription.js';
import { readThrownMessage } from './read-thrown-message.js';
import type {
	BillingInterval,
	ProviderBilling,
	ProviderInvoice,
	ProviderSubscriptionIds,
	SubscriptionProvider,
} from './types.js';

/** The fields read off Mollie's Subscription, which the client does not export. */
type MollieSubscription = {
	id: string;
	customerId: string;
	amount: { currency: string; value: string };
	interval: string;
	nextPaymentDate?: string | null;
	startDate?: string;
	metadata: unknown;
};

const MOLLIE_PAYMENT_ID = /^tr_\w+$/;

const MOLLIE_INTERVAL = /^(\d+) (month|week|day)s?$/;

/** Mollie's recurring guide: a `pending` mandate can already be charged. */
const USABLE_MANDATE_STATUSES = ['valid', 'pending'];

const ENDED_MOLLIE_STATUSES = ['canceled', 'completed'];

/** A first payment in one of these never sets up a mandate. */
const UNPAID_PAYMENT_STATUSES = ['expired', 'failed', 'canceled'];

/** Mollie's `completed` is a fixed-term subscription past its last payment. */
const NORMALIZED_STATUSES: Record<string, string> = {
	pending: 'pending',
	active: 'active',
	canceled: 'canceled',
	suspended: 'suspended',
	completed: 'expired',
};

/** `createMollieSession` null: a hosted checkout, no in-page form tried. */
export function createMollieProvider(
	mollieClient: MollieClient,
	webhookSecrets: string[],
	createMollieSession: MollieSessionCreator | null = null,
): SubscriptionProvider {
	return {
		async verifyWebhook(rawBody, requestHeaders) {
			if (rawBody.length === 0) {
				throw new WebhookIgnoredError({
					provider: 'mollie',
					reason: 'the body is empty',
				});
			}

			verifyMollieSignature(rawBody, requestHeaders, webhookSecrets);

			const { eventType, entityId } = parseMollieEvent(rawBody);

			if (!eventType.startsWith('payment.')) {
				throw new WebhookIgnoredError({
					provider: 'mollie',
					reason: `event type ${JSON.stringify(eventType)} names no payment`,
				});
			}

			if (typeof entityId !== 'string' || !MOLLIE_PAYMENT_ID.test(entityId)) {
				throw new WebhookUnreadableError({
					provider: 'mollie',
					reason: `event entityId ${JSON.stringify(entityId)}`
						+ ' is not a payment id',
				});
			}

			// The sync worker reads the payment back from Mollie: calling it here
			// would let a flood of signed replays spend our API key.
			return entityId;
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

			const currentPeriodEnd = await readPeriodEnd(
				mollieClient,
				mollieSubscription,
			);

			return {
				subscriptionId,
				customerId,
				status: normalizeMollieStatus(
					mollieSubscription.status,
					currentPeriodEnd,
				),
				currentPeriodEnd,
				cancelAtPeriodEnd: mollieSubscription.status === 'canceled',
				directusSubscription: readDirectusSubscription(
					mollieSubscription.metadata,
				),
				billing: readMollieBilling(mollieSubscription),
				...readResumedSubscription(mollieSubscription),
			};
		},

		async cancelAtPeriodEnd(resourceId) {
			const { customerId, subscriptionId } = parseMollieResourceId(resourceId);

			// Fixed, not the client's random key: a retried cancel that Mollie
			// already applied answers the first cancel instead of a 422.
			await mollieClient.customerSubscriptions.cancel(
				subscriptionId,
				{ customerId, idempotencyKey: `cancel-${subscriptionId}` },
			);
		},

		/**
		 * Mollie cannot undo a cancel (a PATCH answers 422 "The subscription has
		 * been cancelled"): a new subscription starts at the paid period's end, on
		 * the mandate the customer already gave. Runs under the caller's row lock.
		 */
		async resumeCancel({ customerId, subscriptionId, periodEnd }) {
			// A resume whose commit failed after this create, or whose sync has not
			// stored the new row yet, is found by its metadata, past the hour the
			// idempotency key lasts. An ended one was a resume the user canceled.
			let endedResumeCount = 0;

			for await (const customerSubscription of mollieClient
				.customerSubscriptions.iterate({ customerId })) {
				if (readMetadataText(customerSubscription, 'resumes')
					!== subscriptionId) {
					continue;
				}

				if (ENDED_MOLLIE_STATUSES.includes(customerSubscription.status)) {
					endedResumeCount += 1;

					continue;
				}

				return {
					resourceId: composeMollieResourceId({
						customerId,
						subscriptionId: customerSubscription.id,
					}),
					isNewSubscription: true,
				};
			}

			const canceledSubscription = await mollieClient.customerSubscriptions
				.get(subscriptionId, { customerId });

			const resumeMandateId = await findResumeMandate(
				mollieClient,
				customerId,
				canceledSubscription.mandateId,
			);

			const createdSubscription = await mollieClient.customerSubscriptions
				.create({
					customerId,
					amount: canceledSubscription.amount,
					interval: canceledSubscription.interval,
					description: canceledSubscription.description,
					mandateId: resumeMandateId,
					startDate: periodEnd.toISOString()
						.slice(0, 10),
					...readRemainingTimes(canceledSubscription),
					metadata: {
						...readMetadataObject(canceledSubscription),
						resumes: subscriptionId,
					},
					idempotencyKey: endedResumeCount === 0
						? `resume-${subscriptionId}`
						: `resume-${subscriptionId}-${endedResumeCount + 1}`,
				});

			return {
				resourceId: composeMollieResourceId({
					customerId,
					subscriptionId: createdSubscription.id,
				}),
				isNewSubscription: true,
			};
		},

		composeResourceId: composeMollieResourceId,

		/**
		 * A customer per checkout, then its first payment: once paid, it holds
		 * the mandate `startPaidCheckout` bills the subscription on.
		 */
		/**
		 * The in-page form first; Mollie refusing its session (a beta) sends the
		 * payer to the hosted page. Mollie down there too answers 503.
		 */
		async createCheckout({
			directusSubscription,
			payerEmail,
			amount,
			planName,
			redirectUrl,
		}) {
			const checkoutMetadata = {
				directus_subscription: String(directusSubscription),
			};

			const paymentDescription = `Subscription ${directusSubscription}`;

			const mollieCustomer = await mollieClient.customers
				.create({ email: payerEmail, metadata: checkoutMetadata })
				.catch(raiseMollieUnavailable);

			let inPageRefusal: string | null = null;

			if (createMollieSession !== null) {
				try {
					return {
						providerCustomerId: mollieCustomer.id,
						clientToken: await createMollieSession({
							amount,
							description: paymentDescription,
							planName,
							redirectUrl,
							customerId: mollieCustomer.id,
							metadata: checkoutMetadata,
						}),
						publishableKey: null,
					};
				}
				catch (sessionError) {
					inPageRefusal = readThrownMessage(sessionError);
				}
			}

			const firstPayment = await mollieClient.payments
				.create({
					amount,
					customerId: mollieCustomer.id,
					sequenceType: SequenceType.first,
					description: paymentDescription,
					redirectUrl,
					metadata: checkoutMetadata,
				})
				.catch(raiseMollieUnavailable);

			const checkoutUrl = firstPayment.getCheckoutUrl();

			if (checkoutUrl === null) {
				throw new Error(
					`Mollie payment ${JSON.stringify(firstPayment.id)} has no`
					+ ' checkout URL',
				);
			}

			return {
				providerCustomerId: mollieCustomer.id,
				url: checkoutUrl,
				inPageRefusal,
			};
		},

		async findCheckoutPayment({ customerId, directusSubscription }) {
			for await (const customerPayment of mollieClient.customerPayments
				.iterate({ customerId })) {
				if (customerPayment.sequenceType === SequenceType.first
					&& customerPayment.status === 'paid'
					&& readDirectusSubscription(customerPayment.metadata)
					=== directusSubscription) {
					return customerPayment.id;
				}
			}

			return null;
		},

		/**
		 * The first charge falls one interval after the payment, which paid the
		 * first period. A retry finds the subscription a lost commit created.
		 */
		async startPaidCheckout({
			paymentId,
			customerId,
			mandateId,
			paidAt,
			amount,
			directusSubscription,
			interval,
		}) {
			for await (const customerSubscription of mollieClient
				.customerSubscriptions.iterate({ customerId })) {
				if (readDirectusSubscription(customerSubscription.metadata)
					=== directusSubscription
					&& !ENDED_MOLLIE_STATUSES.includes(customerSubscription.status)) {
					return composeMollieResourceId({
						customerId,
						subscriptionId: customerSubscription.id,
					});
				}
			}

			const mollieInterval = formatMollieInterval(interval);

			const createdSubscription = await mollieClient.customerSubscriptions
				.create({
					customerId,
					amount,
					interval: mollieInterval,
					description: `Subscription ${directusSubscription}`,
					mandateId,
					startDate: addMollieInterval(new Date(paidAt), mollieInterval)
						.toISOString()
						.slice(0, 10),
					metadata: { directus_subscription: String(directusSubscription) },
					idempotencyKey: `checkout-${paymentId}`,
				});

			return composeMollieResourceId({
				customerId,
				subscriptionId: createdSubscription.id,
			});
		},

		/**
		 * The subscription's payments, and the checkout's first payment, which
		 * carries no subscriptionId: the customer created for that checkout holds
		 * it, under the subscription's `directus_subscription`. A resume is its own
		 * row: the payments of the subscription it resumes stay on that row.
		 */
		async listInvoices(resourceId) {
			const { customerId, subscriptionId } = parseMollieResourceId(resourceId);

			const mollieSubscription = await mollieClient.customerSubscriptions
				.get(subscriptionId, { customerId });

			const providerInvoices: ProviderInvoice[] = [];

			for await (const subscriptionPayment of mollieClient
				.subscriptionPayments.iterate({ customerId, subscriptionId })) {
				providerInvoices.push(readMolliePayment(subscriptionPayment));
			}

			if (readMetadataText(mollieSubscription, 'resumes') !== null) {
				return providerInvoices;
			}

			const directusSubscription = readDirectusSubscription(
				mollieSubscription.metadata,
			);

			for await (const customerPayment of mollieClient.customerPayments
				.iterate({ customerId })) {
				if (customerPayment.sequenceType === SequenceType.first
					&& readDirectusSubscription(customerPayment.metadata)
					=== directusSubscription) {
					providerInvoices.push(readMolliePayment(customerPayment));
				}
			}

			return providerInvoices;
		},
	};
}

/**
 * Unreachable, or a 5xx: Mollie's client gives no status to a failed fetch nor
 * to a body it cannot read. A 4xx is the request's fault, thrown as is.
 */
function raiseMollieUnavailable(callError: unknown): never {
	if (callError instanceof MollieApiError
		&& (callError.statusCode === undefined || callError.statusCode >= 500)) {
		throw new ProviderUnavailableError({
			provider: 'mollie',
			reason: callError.message,
		});
	}

	throw callError;
}

/**
 * Mollie cancels at once, where Stripe cancels at the period end: a canceled
 * subscription whose paid period runs on reads `active`, as Stripe's does. The
 * reconcile reads it again past that end, then `canceled`.
 */
function normalizeMollieStatus(
	mollieStatus: string,
	currentPeriodEnd: Date | null,
): string {
	if (mollieStatus === 'canceled'
		&& currentPeriodEnd !== null
		&& currentPeriodEnd > new Date()) {
		return 'active';
	}

	return NORMALIZED_STATUSES[mollieStatus] ?? mollieStatus;
}

/** Mollie has no invoice page for a payment: the URLs stay null. */
function readMolliePayment(molliePayment: {
	id: string;
	status: string;
	amount: { currency: string; value: string };
	createdAt: string;
	paidAt?: string;
}): ProviderInvoice {
	return {
		providerReference: molliePayment.id,
		status: molliePayment.status,
		amount: molliePayment.amount.value,
		currency: molliePayment.amount.currency.toUpperCase(),
		dateIssued: new Date(molliePayment.createdAt),
		datePaid: molliePayment.paidAt === undefined
			? null
			: new Date(molliePayment.paidAt),
		hostedUrl: null,
		pdfUrl: null,
	};
}

function readIntervalParts({ months, days }: BillingInterval) {
	if (months > 0 && days === 0) {
		return [months, 'month'] as const;
	}

	if (months === 0 && days > 0 && days % 7 === 0) {
		return [days / 7, 'week'] as const;
	}

	return [days, 'day'] as const;
}

function formatMollieInterval({ months, days }: BillingInterval): string {
	const [intervalCount, intervalUnit] = readIntervalParts({ months, days });

	if (intervalCount <= 0 || (months > 0 && days > 0)) {
		throw new Error(
			`Billing interval ${JSON.stringify({ months, days })} is no`
			+ ' Mollie interval',
		);
	}

	return intervalCount === 1
		? `1 ${intervalUnit}`
		: `${intervalCount} ${intervalUnit}s`;
}

/** The canceled subscription's mandate first, else any the customer holds. */
async function findResumeMandate(
	mollieClient: MollieClient,
	customerId: string,
	canceledMandateId: string | undefined,
): Promise<string> {
	let usableMandateId: string | undefined;

	for await (const customerMandate of mollieClient.customerMandates
		.iterate({ customerId })) {
		if (!USABLE_MANDATE_STATUSES.includes(customerMandate.status)) {
			continue;
		}

		if (customerMandate.id === canceledMandateId) {
			return customerMandate.id;
		}

		usableMandateId ??= customerMandate.id;
	}

	if (usableMandateId === undefined) {
		throw new NoValidMandateError({ customerId });
	}

	return usableMandateId;
}

// A fixed-term subscription resumes with the payments it had left; Mollie
// answers `times: null` for an unlimited one.
function readRemainingTimes(canceledSubscription: {
	times: number | null;
	timesRemaining: number;
}) {
	return typeof canceledSubscription.times === 'number'
		? { times: canceledSubscription.timesRemaining }
		: {};
}

/**
 * Mollie signs the raw body: `sha256=` and the lowercase hex HMAC-SHA256. Any
 * listed secret verifies, which covers a move between two webhooks. A "Roll
 * secret" in the dashboard switches the signature at once (probe run
 * 44284543852): until the new secret is deployed each event gets 401 and only
 * arrives through Mollie's retries.
 */
function verifyMollieSignature(
	rawBody: Buffer,
	requestHeaders: IncomingHttpHeaders,
	webhookSecrets: string[],
): void {
	const signatureHeader = requestHeaders['x-mollie-signature'];

	if (typeof signatureHeader !== 'string') {
		throw new WebhookSignatureError({
			provider: 'mollie',
			reason: 'expected one "x-mollie-signature" header, got'
				+ ` ${JSON.stringify(signatureHeader ?? null)}`,
		});
	}

	const receivedSignature = Buffer.from(signatureHeader);

	const isSigned = webhookSecrets.some((webhookSecret) => {
		const bodyDigest = createHmac('sha256', webhookSecret)
			.update(rawBody)
			.digest('hex');

		const expectedSignature = Buffer.from(`sha256=${bodyDigest}`);

		return receivedSignature.length === expectedSignature.length
			&& timingSafeEqual(receivedSignature, expectedSignature);
	});

	if (!isSigned) {
		throw new WebhookSignatureError({
			provider: 'mollie',
			reason: 'the "x-mollie-signature" header does not sign the body',
		});
	}
}

function parseMollieEvent(rawBody: Buffer): {
	eventType: string;
	entityId: unknown;
} {
	let mollieEvent: unknown;

	try {
		mollieEvent = JSON.parse(rawBody.toString('utf8'));
	}
	catch (parseError) {
		throw new WebhookUnreadableError(
			{ provider: 'mollie', reason: 'the body is not JSON' },
			{ cause: parseError },
		);
	}

	const eventFields = typeof mollieEvent === 'object' && mollieEvent !== null
		? mollieEvent
		: {};

	const eventType = 'type' in eventFields
		? eventFields.type
		: null;

	if (typeof eventType !== 'string') {
		throw new WebhookUnreadableError({
			provider: 'mollie',
			reason: `event type ${JSON.stringify(eventType)} is not a string`,
		});
	}

	return {
		eventType,
		entityId: 'entityId' in eventFields
			? eventFields.entityId
			: null,
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
 * The first payment, which sets up the mandate, carries no subscriptionId. A
 * checkout's, paid, starts the subscription; unpaid, it expires the checkout.
 */
async function readPaymentSubscription(
	mollieClient: MollieClient,
	paymentId: string,
): Promise<ProviderSubscriptionIds> {
	const molliePayment = await mollieClient.payments.get(paymentId)
		.catch((error: unknown) => {
			throw mapMollieNotFound(error, paymentId, null);
		});

	const checkoutSubscription = molliePayment.sequenceType === SequenceType.first
		? readDirectusSubscription(molliePayment.metadata)
		: null;

	if (molliePayment.subscriptionId === undefined
		&& checkoutSubscription !== null) {
		refuseCheckoutPayment(molliePayment, checkoutSubscription);
	}

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

function refuseCheckoutPayment(
	molliePayment: {
		id: string;
		status: string;
		customerId?: string;
		mandateId?: string;
		paidAt?: string;
		amount: { currency: string; value: string };
	},
	directusSubscription: number,
): void {
	const { id: paymentId, status: paymentStatus } = molliePayment;

	if (paymentStatus === 'paid'
		&& molliePayment.customerId !== undefined
		&& molliePayment.mandateId !== undefined
		&& molliePayment.paidAt !== undefined) {
		throw new PaidCheckoutError({
			paymentId,
			customerId: molliePayment.customerId,
			mandateId: molliePayment.mandateId,
			paidAt: molliePayment.paidAt,
			amount: {
				currency: molliePayment.amount.currency,
				value: molliePayment.amount.value,
			},
			directusSubscription,
		});
	}

	if (UNPAID_PAYMENT_STATUSES.includes(paymentStatus)) {
		throw new AbandonedCheckoutError({
			checkoutId: paymentId,
			checkoutStatus: paymentStatus,
			directusSubscription,
		});
	}
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

// A deleted customer answers 410 on its subscriptions.
function mapMollieNotFound(
	mollieError: unknown,
	resourceId: string,
	subscriptionId: string | null,
): unknown {
	return mollieError instanceof MollieApiError
		&& (mollieError.statusCode === 404 || mollieError.statusCode === 410)
		? new MissingProviderSubscriptionError(
			{ resourceId, subscriptionId },
			{ cause: mollieError },
		)
		: mollieError;
}

/**
 * Mollie has no period end: the next payment date while the subscription
 * runs, else the newest paid payment plus one interval. A subscription canceled
 * before its first charge ends at its start date: the checkout's first payment
 * or the resumed subscription paid up to it. With neither, null.
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
		return typeof mollieSubscription.startDate === 'string'
			? new Date(`${mollieSubscription.startDate}T00:00:00Z`)
			: null;
	}

	return addMollieInterval(
		new Date(newestPaidPayment.paidAt),
		mollieSubscription.interval,
	);
}

function readMollieBilling(
	mollieSubscription: MollieSubscription,
): ProviderBilling {
	const { intervalCount, intervalUnit } = parseMollieInterval(
		mollieSubscription.interval,
	);

	return {
		// Mollie's value is a decimal string, "10.00" for 10 euros.
		amountCents: Math.round(Number(mollieSubscription.amount.value) * 100),
		currency: mollieSubscription.amount.currency.toUpperCase(),
		interval: intervalUnit === 'month'
			? { months: intervalCount, days: 0 }
			: {
				months: 0,
				days: intervalUnit === 'week'
					? 7 * intervalCount
					: intervalCount,
			},
	};
}

function parseMollieInterval(mollieInterval: string) {
	const intervalMatch = MOLLIE_INTERVAL.exec(mollieInterval);

	if (intervalMatch === null) {
		throw new Error(
			`Mollie interval ${JSON.stringify(mollieInterval)} is not`
			+ ' "<count> months|weeks|days"',
		);
	}

	return {
		intervalCount: Number(intervalMatch[1]),
		intervalUnit: intervalMatch[2]!,
	};
}

function addMollieInterval(startDate: Date, mollieInterval: string): Date {
	const { intervalCount, intervalUnit } = parseMollieInterval(mollieInterval);
	const endDate = new Date(startDate);

	if (intervalUnit === 'month') {
		endDate.setUTCMonth(endDate.getUTCMonth() + intervalCount);

		// Jan 31 rolled over to March: a paid month ends on the last day of Feb.
		if (endDate.getUTCDate() !== startDate.getUTCDate()) {
			endDate.setUTCDate(0);
		}
	}
	else if (intervalUnit === 'week') {
		endDate.setUTCDate(endDate.getUTCDate() + 7 * intervalCount);
	}
	else {
		endDate.setUTCDate(endDate.getUTCDate() + intervalCount);
	}

	return endDate;
}

function readMetadataObject(
	mollieSubscription: { metadata: unknown },
): Record<string, unknown> {
	const subscriptionMetadata = mollieSubscription.metadata;

	return typeof subscriptionMetadata === 'object'
		&& subscriptionMetadata !== null
		? subscriptionMetadata as Record<string, unknown>
		: {};
}

function readMetadataText(
	mollieSubscription: { metadata: unknown },
	metadataKey: string,
): string | null {
	const metadataValue = readMetadataObject(mollieSubscription)[metadataKey];

	return typeof metadataValue === 'string'
		? metadataValue
		: null;
}

function readResumedSubscription(mollieSubscription: MollieSubscription) {
	const resumedSubscriptionId = readMetadataText(mollieSubscription, 'resumes');

	return resumedSubscriptionId === null
		? {}
		: { resumedSubscriptionId };
}
