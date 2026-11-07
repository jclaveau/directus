import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export type MollieHolding = {
	payment: string;
	customer: string;
	subscription: string | null;
	plan_reference: string;
	status: string;
	paid_at?: string;
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
	body: string | null;
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
			mollieHolding.status = 'canceled';
		}

		return {
			code: 200,
			body: {
				resource: 'subscription',
				id: subscriptionId,
				customerId,
				status: mollieHolding.status,
				interval: '1 month',
				nextPaymentDate: mollieHolding.status === 'canceled'
					? undefined
					: '2099-01-01',
				metadata: { plan: mollieHolding.plan_reference },
			},
		};
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
		requestBody: string | null,
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

		const stripeMatch = /^\/v1\/subscriptions\/(\w+)$/.exec(requestPath);

		return stripeMatch === null
			? undefined
			: answerStripeSubscription(stripeMatch[1]!, requestBody);
	}

	const fakeServer = createServer(async (providerRequest, providerResponse) => {
		const requestPath = new URL(providerRequest.url!, 'http://provider').pathname;
		const requestMethod = providerRequest.method!;
		const requestBody = await readRequestBody(providerRequest);

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
