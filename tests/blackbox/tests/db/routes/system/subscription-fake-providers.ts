import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export type MollieHolding = {
	payment: string;
	customer: string;
	subscription: string | null;
	plan_reference: string;
	status: string;
	paid_at?: string;
	/** Set on a subscription the bundle created to resume `resumes`. */
	resumes?: string;
	start_date?: string;
};

export type MollieMandate = {
	mandate: string;
	customer: string;
	status: string;
};

export type StripeHolding = {
	subscription: string;
	customer: string;
	price: string;
	status: string;
	cancel_at_period_end?: boolean;
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
	const forgottenSubscriptions = new Set<string>();
	const unansweredPaths: string[] = [];
	const receivedWrites: ReceivedWrite[] = [];

	function answerMolliePayment(paymentId: string): FakeAnswer | undefined {
		const molliePayment = mollieHoldings.get(paymentId);

		if (molliePayment === undefined) {
			return undefined;
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
		return {
			resource: 'subscription',
			id: mollieHolding.subscription,
			customerId: mollieHolding.customer,
			status: mollieHolding.status,
			amount: { currency: 'EUR', value: '10.00' },
			times: null,
			timesRemaining: null,
			interval: '1 month',
			description: `Plan ${mollieHolding.plan_reference}`,
			nextPaymentDate: mollieHolding.status === 'canceled'
				? undefined
				: mollieHolding.start_date ?? '2099-01-01',
			metadata: mollieHolding.resumes === undefined
				? { plan: mollieHolding.plan_reference }
				: {
					plan: mollieHolding.plan_reference,
					resumes: mollieHolding.resumes,
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
	// knows its id up front.
	function createMollieSubscription(
		customerId: string,
		requestBody: string | object | null,
	): FakeAnswer {
		const { metadata } = requestBody as {
			metadata: { plan: string; resumes: string };
			startDate: string;
		};

		const resumeCount = [...mollieHoldings.values()]
			.filter((mollieHolding) => {
				return mollieHolding.resumes === metadata.resumes;
			})
			.length;

		const createdSubscription = `${metadata.resumes}_${resumeCount + 2}`;

		const createdHolding: MollieHolding = {
			payment: `tr_${createdSubscription}`,
			customer: customerId,
			subscription: createdSubscription,
			plan_reference: metadata.plan,
			status: 'active',
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

		if (requestBody === 'cancel_at_period_end=true') {
			stripeHolding.cancel_at_period_end = true;
		}

		return {
			code: 200,
			body: {
				id: subscriptionId,
				object: 'subscription',
				customer: stripeHolding.customer,
				status: stripeHolding.status,
				cancel_at_period_end: stripeHolding.cancel_at_period_end === true,
				items: {
					object: 'list',
					data: [{
						id: `si_${subscriptionId}`,
						current_period_end: STRIPE_PERIOD_END,
						price: { id: stripeHolding.price },
					}],
				},
			},
		};
	}

	function answerProvider(
		requestMethod: string,
		requestPath: string,
		requestBody: string | object | null,
	): FakeAnswer | undefined {
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
