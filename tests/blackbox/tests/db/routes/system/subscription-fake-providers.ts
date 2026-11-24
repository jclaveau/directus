import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export type MollieHolding = {
	payment: string;
	customer: string;
	subscription: string | null;
	/** The `subscriptions.id` in the metadata of the same name. */
	directus_subscription: number | null;
	status: string;
	/** Defaults to the "10.00" every seeded plan sells. */
	amount?: string;
	paid_at?: string;
	/** Set on a subscription the bundle created to resume `resumes`. */
	resumes?: string;
	start_date?: string;
	/** Set on a checkout's first payment, which carries no subscription. */
	sequence_type?: 'first';
	/** The mandate a paid first payment set up. */
	mandate?: string;
};

export type MollieMandate = {
	mandate: string;
	customer: string;
	status: string;
};

export type StripeHolding = {
	subscription: string;
	customer: string;
	directus_subscription: number | null;
	status: string;
	cancel_at_period_end?: boolean;
	/** The price's cents; the recorded 1000 without it. */
	unit_amount?: number;
};

type StripeSession = {
	session: string;
	directus_subscription: string;
	status: string;
};

export type ReceivedWrite = {
	method: string;
	path: string;
	/** Parsed when Mollie's client sent JSON. */
	body: string | object | null;
};

type FakeAnswer = { code: number; body: object };

// 2099-01-01T00:00:00Z
const STRIPE_PERIOD_END = 4_070_908_800;

// The subscription Stripe's test mode sent, recorded by
// scripts/stripe-behaviour/stripe-webhook-probe.mjs: the fake answers its
// shape, with the holding's ids and state.
const RECORDED_STRIPE_SUBSCRIPTION = JSON.parse(readFileSync(
	new URL(
		'../../../../../../scripts/stripe-behaviour/'
		+ 'stripe-behaviour.recorded-events.json',
		import.meta.url,
	),
	'utf8',
))['subscription created: customer.subscription.created'].data.object;

const MOLLIE_NOT_FOUND: FakeAnswer = {
	code: 404,
	body: {
		status: 404,
		title: 'Not Found',
		detail: 'No such subscription',
		_links: {},
	},
};

// What Mollie's test mode answers a DELETE on a canceled subscription.
const MOLLIE_ALREADY_CANCELED: FakeAnswer = {
	code: 422,
	body: {
		status: 422,
		title: 'Unprocessable Entity',
		detail: 'The subscription has been cancelled',
		_links: {},
	},
};

const STRIPE_NOT_FOUND: FakeAnswer = {
	code: 404,
	body: {
		error: {
			code: 'resource_missing',
			type: 'invalid_request_error',
			message: 'No such subscription',
		},
	},
};

async function readRequestBody(
	providerRequest: IncomingMessage,
): Promise<string | null> {
	const bodyChunks: Buffer[] = [];

	for await (const bodyChunk of providerRequest) {
		bodyChunks.push(bodyChunk as Buffer);
	}

	const requestBody = Buffer.concat(bodyChunks)
		.toString('utf8');

	// Mollie's client sends `{}` along with a DELETE.
	return requestBody === '' || requestBody === '{}'
		? null
		: requestBody;
}

/**
 * Answers what a scenario said a provider holds, on one port for both. A path it
 * has no answer for answers 500 and lands in `unansweredPaths`, which a scenario
 * reads with its rows.
 */
export async function startFakeProviders() {
	const mollieHoldings = new Map<string, MollieHolding>();
	const stripeHoldings = new Map<string, StripeHolding>();
	const mollieMandates = new Map<string, MollieMandate>();
	const stripeSessions = new Map<string, StripeSession>();
	const forgottenSubscriptions = new Set<string>();
	const unansweredPaths: string[] = [];
	const receivedWrites: ReceivedWrite[] = [];

	function answerMolliePayment(paymentId: string): FakeAnswer | undefined {
		const molliePayment = mollieHoldings.get(paymentId);

		if (molliePayment === undefined) {
			return undefined;
		}

		if (molliePayment.sequence_type === 'first') {
			return { code: 200, body: composeFirstPayment(molliePayment) };
		}

		return {
			code: 200,
			body: {
				resource: 'payment',
				id: paymentId,
				customerId: molliePayment.customer,
				subscriptionId: molliePayment.subscription ?? undefined,
			},
		};
	}

	function composeFirstPayment(firstPayment: MollieHolding) {
		return {
			resource: 'payment',
			id: firstPayment.payment,
			customerId: firstPayment.customer,
			status: firstPayment.status,
			sequenceType: 'first',
			mandateId: firstPayment.mandate,
			paidAt: firstPayment.paid_at,
			amount: { currency: 'EUR', value: firstPayment.amount ?? '10.00' },
			metadata: {
				directus_subscription: String(firstPayment.directus_subscription),
			},
			_links: {
				checkout: {
					href: `https://www.mollie.com/checkout/${firstPayment.payment}`,
					type: 'text/html',
				},
			},
		};
	}

	// A checkout's customer and first payment, named after the row the metadata
	// names, so a scenario knows their ids up front.
	function createMollieCheckout(
		checkoutResource: string,
		requestBody: string | object | null,
	): FakeAnswer {
		const {
			metadata: checkoutMetadata,
			customerId,
			amount: paidAmount,
		} = requestBody as {
			metadata: { directus_subscription: string };
			customerId?: string;
			amount?: { value: string };
		};

		const directusSubscription = checkoutMetadata.directus_subscription;

		if (checkoutResource === 'customers') {
			return {
				code: 201,
				body: {
					resource: 'customer',
					id: `cst_checkout_${directusSubscription}`,
					metadata: checkoutMetadata,
					_links: {},
				},
			};
		}

		const firstPayment: MollieHolding = {
			payment: `tr_checkout_${directusSubscription}`,
			customer: customerId!,
			subscription: null,
			directus_subscription: Number(directusSubscription),
			status: 'open',
			amount: paidAmount!.value,
			sequence_type: 'first',
		};

		mollieHoldings.set(firstPayment.payment, firstPayment);

		return { code: 201, body: composeFirstPayment(firstPayment) };
	}

	function answerMollieSubscription(
		requestMethod: string,
		customerId: string,
		subscriptionId: string,
		isPaymentList: boolean,
	): FakeAnswer | undefined {
		if (forgottenSubscriptions.has(subscriptionId)) {
			return MOLLIE_NOT_FOUND;
		}

		const mollieHolding = [...mollieHoldings.values()].find((candidate) => {
			return candidate.customer === customerId
				&& candidate.subscription === subscriptionId;
		});

		if (mollieHolding === undefined) {
			return undefined;
		}

		if (isPaymentList) {
			return {
				code: 200,
				body: {
					count: 1,
					_embedded: {
						payments: mollieHolding.paid_at === undefined
							? []
							: [{
								resource: 'payment',
								id: mollieHolding.payment,
								status: 'paid',
								paidAt: mollieHolding.paid_at,
							}],
					},
					_links: { next: null },
				},
			};
		}

		if (requestMethod === 'DELETE') {
			if (mollieHolding.status === 'canceled') {
				return MOLLIE_ALREADY_CANCELED;
			}

			mollieHolding.status = 'canceled';
		}

		return { code: 200, body: composeMollieSubscription(mollieHolding) };
	}

	function composeMollieSubscription(mollieHolding: MollieHolding) {
		const { directus_subscription: directusSubscription } = mollieHolding;

		return {
			resource: 'subscription',
			id: mollieHolding.subscription,
			customerId: mollieHolding.customer,
			status: mollieHolding.status,
			amount: { currency: 'EUR', value: mollieHolding.amount ?? '10.00' },
			times: null,
			timesRemaining: null,
			interval: '1 month',
			description: `Subscription ${JSON.stringify(directusSubscription)}`,
			nextPaymentDate: mollieHolding.status === 'canceled'
				? undefined
				: mollieHolding.start_date ?? '2099-01-01',
			metadata: {
				...directusSubscription === null
					? {}
					: { directus_subscription: String(directusSubscription) },
				...mollieHolding.resumes === undefined
					? {}
					: { resumes: mollieHolding.resumes },
			},
		};
	}

	function answerMollieList(embeddedName: string, embeddedItems: object[]) {
		return {
			code: 200,
			body: {
				count: embeddedItems.length,
				_embedded: { [embeddedName]: embeddedItems },
				_links: { next: null },
			},
		};
	}

	// What the bundle sends to resume a cancel: a subscription named after the
	// one it resumes and its attempt, `sub_x_2` then `sub_x_3`, so a scenario
	// knows its id up front. A paid checkout's is `sub_checkout_<row id>`.
	function createMollieSubscription(
		customerId: string,
		requestBody: string | object | null,
	): FakeAnswer {
		const { metadata, amount: createdAmount } = requestBody as {
			amount: { value: string };
			metadata: { directus_subscription?: string; resumes?: string };
			startDate: string;
		};

		const resumeCount = [...mollieHoldings.values()]
			.filter((mollieHolding) => {
				return mollieHolding.resumes === metadata.resumes;
			})
			.length;

		const createdSubscription = metadata.resumes === undefined
			? `sub_checkout_${metadata.directus_subscription}`
			: `${metadata.resumes}_${resumeCount + 2}`;

		const createdHolding: MollieHolding = {
			payment: `tr_${createdSubscription}`,
			customer: customerId,
			subscription: createdSubscription,
			directus_subscription: metadata.directus_subscription === undefined
				? null
				: Number(metadata.directus_subscription),
			status: 'active',
			amount: createdAmount.value,
			resumes: metadata.resumes,
			start_date: (requestBody as { startDate: string }).startDate,
		};

		mollieHoldings.set(createdHolding.payment, createdHolding);

		return { code: 201, body: composeMollieSubscription(createdHolding) };
	}

	function answerMollieCustomer(
		requestMethod: string,
		customerId: string,
		customerResource: string,
		requestBody: string | object | null,
	): FakeAnswer {
		if (customerResource === 'mandates') {
			return answerMollieList(
				'mandates',
				[...mollieMandates.values()]
					.filter((mollieMandate) => mollieMandate.customer === customerId)
					.map((mollieMandate) => {
						return {
							resource: 'mandate',
							id: mollieMandate.mandate,
							status: mollieMandate.status,
						};
					}),
			);
		}

		if (requestMethod === 'POST') {
			return createMollieSubscription(customerId, requestBody);
		}

		return answerMollieList(
			'subscriptions',
			[...mollieHoldings.values()]
				.filter((mollieHolding) => {
					return mollieHolding.customer === customerId
						&& mollieHolding.subscription !== null;
				})
				.map(composeMollieSubscription),
		);
	}

	function answerStripeSubscription(
		subscriptionId: string,
		requestBody: string | null,
	): FakeAnswer | undefined {
		if (forgottenSubscriptions.has(subscriptionId)) {
			return STRIPE_NOT_FOUND;
		}

		const stripeHolding = stripeHoldings.get(subscriptionId);

		if (stripeHolding === undefined) {
			return undefined;
		}

		const cancelUpdate = /^cancel_at_period_end=(true|false)$/
			.exec(requestBody ?? '');

		if (cancelUpdate !== null) {
			stripeHolding.cancel_at_period_end = cancelUpdate[1] === 'true';
		}

		return {
			code: 200,
			body: {
				...RECORDED_STRIPE_SUBSCRIPTION,
				id: subscriptionId,
				customer: stripeHolding.customer,
				status: stripeHolding.status,
				cancel_at_period_end: stripeHolding.cancel_at_period_end === true,
				metadata: stripeHolding.directus_subscription === null
					? {}
					: {
						directus_subscription: String(
							stripeHolding.directus_subscription,
						),
					},
				items: {
					...RECORDED_STRIPE_SUBSCRIPTION.items,
					data: [{
						...RECORDED_STRIPE_SUBSCRIPTION.items.data[0],
						current_period_end: STRIPE_PERIOD_END,
						price: {
							...RECORDED_STRIPE_SUBSCRIPTION.items.data[0].price,
							unit_amount: stripeHolding.unit_amount ?? 1000,
						},
					}],
				},
			},
		};
	}

	function createStripeSession(requestBody: string | null): FakeAnswer {
		const directusSubscription = new URLSearchParams(requestBody ?? '')
			.get('metadata[directus_subscription]')!;

		const stripeSession: StripeSession = {
			session: `cs_checkout_${directusSubscription}`,
			directus_subscription: directusSubscription,
			status: 'open',
		};

		stripeSessions.set(stripeSession.session, stripeSession);

		return { code: 200, body: composeStripeSession(stripeSession) };
	}

	function composeStripeSession(stripeSession: StripeSession) {
		return {
			id: stripeSession.session,
			object: 'checkout.session',
			url: `https://checkout.stripe.com/c/pay/${stripeSession.session}`,
			status: stripeSession.status,
			metadata: { directus_subscription: stripeSession.directus_subscription },
		};
	}

	function answerStripeSession(sessionId: string): FakeAnswer | undefined {
		const stripeSession = stripeSessions.get(sessionId);

		return stripeSession === undefined
			? undefined
			: { code: 200, body: composeStripeSession(stripeSession) };
	}

	function answerProvider(
		requestMethod: string,
		requestPath: string,
		requestBody: string | object | null,
	): FakeAnswer | undefined {
		const checkoutMatch = /^\/v2\/(customers|payments)$/.exec(requestPath);

		if (checkoutMatch !== null && requestMethod === 'POST') {
			return createMollieCheckout(checkoutMatch[1]!, requestBody);
		}

		if (requestPath === '/v1/checkout/sessions' && requestMethod === 'POST') {
			return createStripeSession(requestBody as string | null);
		}

		const sessionMatch = /^\/v1\/checkout\/sessions\/(\w+)$/.exec(requestPath);

		if (sessionMatch !== null) {
			return answerStripeSession(sessionMatch[1]!);
		}

		const paymentMatch = /^\/v2\/payments\/(\w+)$/.exec(requestPath);

		if (paymentMatch !== null) {
			return answerMolliePayment(paymentMatch[1]!);
		}

		const mollieMatch = /^\/v2\/customers\/(\w+)\/subscriptions\/(\w+)(\/payments)?$/
			.exec(requestPath);

		if (mollieMatch !== null) {
			return answerMollieSubscription(
				requestMethod,
				mollieMatch[1]!,
				mollieMatch[2]!,
				mollieMatch[3] !== undefined,
			);
		}

		const customerMatch = /^\/v2\/customers\/(\w+)\/(subscriptions|mandates)$/
			.exec(requestPath);

		if (customerMatch !== null) {
			return answerMollieCustomer(
				requestMethod,
				customerMatch[1]!,
				customerMatch[2]!,
				requestBody,
			);
		}

		// The invoices the bundle copies on each sync: none in these scenarios.
		if (/^\/v2\/customers\/\w+\/payments$/.test(requestPath)) {
			return answerMollieList('payments', []);
		}

		if (requestPath === '/v1/invoices') {
			return {
				code: 200,
				body: {
					object: 'list',
					data: [],
					has_more: false,
					url: '/v1/invoices',
				},
			};
		}

		const stripeMatch = /^\/v1\/subscriptions\/(\w+)$/.exec(requestPath);

		return stripeMatch === null
			? undefined
			: answerStripeSubscription(stripeMatch[1]!, requestBody as string | null);
	}

	const fakeServer = createServer(async (providerRequest, providerResponse) => {
		const requestPath = new URL(providerRequest.url!, 'http://provider').pathname;
		const requestMethod = providerRequest.method!;
		const requestText = await readRequestBody(providerRequest);

		const requestBody = requestText !== null
			&& providerRequest.headers['content-type'] === 'application/json'
			? JSON.parse(requestText) as object
			: requestText;

		if (requestMethod !== 'GET') {
			receivedWrites.push({
				method: requestMethod,
				path: requestPath,
				body: requestBody,
			});
		}

		const fakeAnswer = answerProvider(requestMethod, requestPath, requestBody);

		if (fakeAnswer === undefined) {
			unansweredPaths.push(requestPath);
			providerResponse.writeHead(500);
			providerResponse.end();

			return;
		}

		providerResponse.writeHead(fakeAnswer.code, {
			'Content-Type': requestPath.startsWith('/v2/')
				? 'application/hal+json'
				: 'application/json',
		});

		providerResponse.end(JSON.stringify(fakeAnswer.body));
	});

	await new Promise<void>((resolveListen) => {
		fakeServer.listen(0, '127.0.0.1', resolveListen);
	});

	return {
		listeningPort: (fakeServer.address() as AddressInfo).port,
		unansweredPaths,
		receivedWrites,
		holdAtMollie(mollieHolding: MollieHolding) {
			mollieHoldings.set(mollieHolding.payment, mollieHolding);
		},
		holdMandateAtMollie(mollieMandate: MollieMandate) {
			mollieMandates.set(mollieMandate.mandate, mollieMandate);
		},
		holdAtStripe(stripeHolding: StripeHolding) {
			stripeHoldings.set(stripeHolding.subscription, stripeHolding);
		},
		// Merged into the first payment the checkout created, keeping its amount.
		holdFirstPaymentAtMollie(firstPayment: MollieHolding) {
			mollieHoldings.set(firstPayment.payment, {
				...mollieHoldings.get(firstPayment.payment),
				...firstPayment,
				sequence_type: 'first',
			});
		},
		expirePaymentAtMollie(paymentId: string) {
			const expiredPayment = mollieHoldings.get(paymentId);

			if (expiredPayment === undefined) {
				throw new Error(
					`The fake Mollie holds no payment ${JSON.stringify(paymentId)}`,
				);
			}

			expiredPayment.status = 'expired';
		},
		expireSessionAtStripe(sessionId: string) {
			const expiredSession = stripeSessions.get(sessionId);

			if (expiredSession === undefined) {
				throw new Error(
					`The fake Stripe holds no checkout session`
					+ ` ${JSON.stringify(sessionId)}`,
				);
			}

			expiredSession.status = 'expired';
		},
		forgetSubscription(subscriptionId: string) {
			forgottenSubscriptions.add(subscriptionId);
		},
		stopListening() {
			return new Promise((resolveClose) => {
				fakeServer.close(resolveClose);
			});
		},
	};
}
