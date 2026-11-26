/* eslint-disable no-console -- a server process, its log is pm2's output */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import {
	composeRealProviderUrl,
	pickProvidersTarget,
	PROVIDERS_MODES,
} from './pick-providers-target.mjs';

// The preview's Stripe and Mollie: one process holding what each checkout
// created, so every PM2 worker of Directus reads the same payments. Directus
// reaches it through the examples endpoint's reroute of api.stripe.com and
// api.mollie.com; its pay page posts the outcome picked to `/pay/<payment>`,
// which sends the provider's signed webhook back to Directus.
//
// Started with the real test-mode keys (SUBSCRIPTIONS_EXAMPLES_REAL_PROVIDERS),
// it also forwards calls to Stripe and Mollie themselves, per the mode the
// examples module's header switches through `/providers-mode`.

const PAY_PATH = '/subscriptions-examples/pay/';

const PAY_OUTCOMES = ['paid', 'failed', 'canceled'];

const RECORDED_STRIPE_EVENT = JSON.parse(readFileSync(
	new URL(
		'../../../../scripts/stripe-behaviour/'
		+ 'stripe-behaviour.recorded-events.json',
		import.meta.url,
	),
	'utf8',
))['subscription created: customer.subscription.created'];

const RECORDED_STRIPE_SUBSCRIPTION = RECORDED_STRIPE_EVENT.data.object;

const MOLLIE_NOT_FOUND = {
	code: 404,
	body: {
		status: 404,
		title: 'Not Found',
		detail: 'No such subscription',
		_links: {},
	},
};

const MOLLIE_ALREADY_CANCELED = {
	code: 422,
	body: {
		status: 422,
		title: 'Unprocessable Entity',
		detail: 'The subscription has been cancelled',
		_links: {},
	},
};

// The fakes have only their pay page: refusing the in-page form sends the
// checkout there, the way a provider refusing it in production does.
const MOLLIE_NO_SESSIONS = {
	code: 422,
	body: {
		status: 422,
		title: 'Unprocessable Entity',
		detail: 'The fake providers have no in-page form',
		_links: {},
	},
};

const STRIPE_NO_ELEMENTS = {
	code: 400,
	body: {
		error: {
			type: 'invalid_request_error',
			param: 'ui_mode',
			message: 'The fake providers have no in-page form',
		},
	},
};

const STRIPE_NOT_FOUND = {
	code: 404,
	body: {
		error: {
			code: 'resource_missing',
			type: 'invalid_request_error',
			message: 'No such subscription',
		},
	},
};

function readRequiredEnv(variableName) {
	const variableValue = process.env[variableName];

	if (variableValue === undefined || variableValue === '') {
		throw new Error(
			`The fake providers need ${JSON.stringify(variableName)}, got`
			+ ` ${JSON.stringify(variableValue ?? null)}`,
		);
	}

	return variableValue;
}

function readPaidAt() {
	const pinnedDate = process.env['SUBSCRIPTIONS_EXAMPLES_FAKE_PAID_AT'];

	if (pinnedDate === undefined || pinnedDate === '') {
		return new Date();
	}

	const paidAt = new Date(`${pinnedDate}T00:00:00Z`);

	if (Number.isNaN(paidAt.getTime())) {
		throw new Error(
			'"SUBSCRIPTIONS_EXAMPLES_FAKE_PAID_AT" is a YYYY-MM-DD date, got'
			+ ` ${JSON.stringify(pinnedDate)}`,
		);
	}

	return paidAt;
}

const listeningPort = Number(
	readRequiredEnv('SUBSCRIPTIONS_EXAMPLES_PROVIDERS_PORT'),
);

const publicUrl = readRequiredEnv('PUBLIC_URL').replace(/\/+$/, '');

const directusUrl = (
	process.env['SUBSCRIPTIONS_EXAMPLES_DIRECTUS_URL'] ?? 'http://127.0.0.1:8055'
).replace(/\/+$/, '');

const stripeSecret = readRequiredEnv('SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET');

const mollieSecret = readRequiredEnv('SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS')
	.split(',')[0]
	.trim();

const isRealAvailable = process.env['SUBSCRIPTIONS_EXAMPLES_REAL_PROVIDERS']
	=== 'true';

let providersMode = isRealAvailable
	? 'real'
	: 'fake';

/** Mollie first payments and Stripe checkout sessions, by their id. */
const payHoldings = new Map();

/** Mollie subscriptions by id, created once a first payment is paid. */
const mollieSubscriptions = new Map();

/** Stripe subscriptions by id, created once a session is paid. */
const stripeSubscriptions = new Map();

let eventCount = 0;

function addMonths(startDate, monthCount) {
	const shiftedDate = new Date(startDate);

	shiftedDate.setUTCMonth(shiftedDate.getUTCMonth() + monthCount);

	return shiftedDate;
}

function parseStripeForm(requestText) {
	return Object.fromEntries(new URLSearchParams(requestText ?? ''));
}

async function readRequestText(providerRequest) {
	const bodyChunks = [];

	for await (const bodyChunk of providerRequest) {
		bodyChunks.push(bodyChunk);
	}

	return Buffer.concat(bodyChunks)
		.toString('utf8');
}

function answerProvidersMode(requestMethod, requestText) {
	if (requestMethod === 'GET') {
		return {
			code: 200,
			body: { mode: providersMode, real_available: isRealAvailable },
		};
	}

	const { mode: pickedMode } = JSON.parse(requestText ?? '{}');

	if (!PROVIDERS_MODES.includes(pickedMode)) {
		return {
			code: 400,
			body: {
				error: '"mode" is "fake" or "real", got'
					+ ` ${JSON.stringify(pickedMode ?? null)}`,
			},
		};
	}

	if (pickedMode === 'real' && !isRealAvailable) {
		return {
			code: 409,
			body: {
				error: 'the preview booted with no real Stripe and Mollie test keys:'
					+ ' only a run its repository\'s owner starts on one of its own'
					+ ' branches gets them',
			},
		};
	}

	providersMode = pickedMode;

	return {
		code: 200,
		body: { mode: providersMode, real_available: isRealAvailable },
	};
}

const DROPPED_HEADERS = [
	'host',
	'connection',
	'content-length',
	'transfer-encoding',
	'accept-encoding',
];

/** Never logs the call: its Authorization header holds the real key. */
async function forwardToRealProvider(providerRequest, rawText, providerResponse) {
	const realAnswer = await fetch(composeRealProviderUrl(providerRequest.url), {
		method: providerRequest.method,
		headers: Object.fromEntries(
			Object.entries(providerRequest.headers).filter(([headerName]) => {
				return !DROPPED_HEADERS.includes(headerName);
			}),
		),
		body: ['GET', 'HEAD'].includes(providerRequest.method)
			? undefined
			: rawText,
	});

	providerResponse.writeHead(realAnswer.status, {
		'Content-Type': realAnswer.headers.get('content-type') ?? 'application/json',
	});

	providerResponse.end(await realAnswer.text());
}

function composeMolliePayment(payHolding) {
	return {
		resource: 'payment',
		id: payHolding.payment,
		mode: 'test',
		status: payHolding.status,
		sequenceType: 'first',
		amount: { currency: payHolding.currency, value: payHolding.amount },
		description: payHolding.description,
		customerId: payHolding.customer,
		mandateId: payHolding.status === 'paid'
			? payHolding.mandate
			: undefined,
		paidAt: payHolding.paid_at,
		redirectUrl: payHolding.redirect_url,
		metadata: payHolding.metadata,
		createdAt: payHolding.created_at,
		_links: {
			checkout: { href: payHolding.pay_url, type: 'text/html' },
		},
	};
}

function composeMollieSubscription(mollieSubscription) {
	return {
		resource: 'subscription',
		id: mollieSubscription.subscription,
		mode: 'test',
		customerId: mollieSubscription.customer,
		mandateId: mollieSubscription.mandate,
		status: mollieSubscription.status,
		amount: mollieSubscription.amount,
		times: null,
		timesRemaining: null,
		interval: mollieSubscription.interval,
		description: mollieSubscription.description,
		startDate: mollieSubscription.start_date,
		nextPaymentDate: mollieSubscription.status === 'canceled'
			? undefined
			: mollieSubscription.start_date,
		metadata: mollieSubscription.metadata,
	};
}

function composeStripeSession(payHolding) {
	return {
		id: payHolding.payment,
		object: 'checkout.session',
		mode: 'subscription',
		livemode: false,
		status: payHolding.status === 'open'
? 'open'
: 'expired',
		customer: payHolding.customer,
		customer_email: payHolding.email,
		subscription: payHolding.status === 'paid'
			? payHolding.subscription
			: null,
		metadata: payHolding.metadata,
		success_url: payHolding.redirect_url,
		cancel_url: payHolding.cancel_url,
		url: payHolding.pay_url,
	};
}

function composeStripeSubscription(stripeSubscription) {
	const recordedItem = RECORDED_STRIPE_SUBSCRIPTION.items.data[0];

	return {
		...RECORDED_STRIPE_SUBSCRIPTION,
		id: stripeSubscription.subscription,
		customer: stripeSubscription.customer,
		status: stripeSubscription.status,
		currency: stripeSubscription.currency,
		cancel_at_period_end: stripeSubscription.cancel_at_period_end,
		metadata: stripeSubscription.metadata,
		items: {
			...RECORDED_STRIPE_SUBSCRIPTION.items,
			data: [{
				...recordedItem,
				current_period_end: stripeSubscription.period_end,
				price: {
					...recordedItem.price,
					currency: stripeSubscription.currency,
					unit_amount: stripeSubscription.unit_amount,
					unit_amount_decimal: String(stripeSubscription.unit_amount),
					recurring: {
						...recordedItem.price.recurring,
						interval: stripeSubscription.interval,
						interval_count: stripeSubscription.interval_count,
					},
				},
			}],
		},
	};
}

function createMollieCustomer(requestBody) {
	const checkoutId = requestBody.metadata.directus_subscription;

	return {
		code: 201,
		body: {
			resource: 'customer',
			id: `cst_examples_${checkoutId}`,
			mode: 'test',
			email: requestBody.email,
			metadata: requestBody.metadata,
		},
	};
}

function createMolliePayment(requestBody) {
	const checkoutId = requestBody.metadata.directus_subscription;
	const paymentId = `tr_examples_${checkoutId}`;

	const payHolding = {
		provider: 'mollie',
		payment: paymentId,
		customer: requestBody.customerId,
		mandate: `mdt_examples_${checkoutId}`,
		status: 'open',
		amount: requestBody.amount.value,
		currency: requestBody.amount.currency,
		description: requestBody.description,
		redirect_url: requestBody.redirectUrl,
		metadata: requestBody.metadata,
		created_at: new Date()
			.toISOString(),
		pay_url: `${publicUrl}${PAY_PATH}${paymentId}`,
	};

	payHoldings.set(paymentId, payHolding);

	return { code: 201, body: composeMolliePayment(payHolding) };
}

function createMollieSubscription(customerId, requestBody) {
	const { metadata } = requestBody;
	let subscriptionId;

	// The bundle resumes a cancel with a subscription naming the one it
	// resumes: `sub_x_2`, then `sub_x_3`.
	if (typeof metadata.resumes === 'string') {
		const resumeCount = [...mollieSubscriptions.values()]
			.filter((mollieSubscription) => {
				return mollieSubscription.metadata.resumes === metadata.resumes;
			})
			.length;

		subscriptionId = `${metadata.resumes}_${resumeCount + 2}`;
	}
	else {
		subscriptionId = `sub_examples_${metadata.directus_subscription}`;
	}

	const mollieSubscription = {
		subscription: subscriptionId,
		customer: customerId,
		mandate: requestBody.mandateId,
		status: 'active',
		amount: requestBody.amount,
		interval: requestBody.interval,
		description: requestBody.description,
		start_date: requestBody.startDate,
		metadata,
	};

	mollieSubscriptions.set(subscriptionId, mollieSubscription);

	return { code: 201, body: composeMollieSubscription(mollieSubscription) };
}

function answerMollieList(embeddedName, embeddedItems) {
	return {
		code: 200,
		body: {
			count: embeddedItems.length,
			_embedded: { [embeddedName]: embeddedItems },
			_links: { next: null },
		},
	};
}

function answerMollieSubscription(requestMethod, customerId, subscriptionId) {
	const mollieSubscription = mollieSubscriptions.get(subscriptionId);

	if (mollieSubscription === undefined
		|| mollieSubscription.customer !== customerId) {
		return MOLLIE_NOT_FOUND;
	}

	if (requestMethod === 'DELETE') {
		if (mollieSubscription.status === 'canceled') {
			return MOLLIE_ALREADY_CANCELED;
		}

		mollieSubscription.status = 'canceled';
	}

	return { code: 200, body: composeMollieSubscription(mollieSubscription) };
}

function answerMollieCustomerPayments(customerId) {
	return answerMollieList(
		'payments',
		[...payHoldings.values()]
			.filter((payHolding) => {
				return payHolding.provider === 'mollie'
					&& payHolding.customer === customerId;
			})
			.map(composeMolliePayment),
	);
}

function answerMollieMandates(customerId) {
	const customerMandates = [...payHoldings.values()]
		.filter((payHolding) => {
			return payHolding.provider === 'mollie'
				&& payHolding.customer === customerId
				&& payHolding.status === 'paid';
		})
		.map((payHolding) => {
			return {
				resource: 'mandate',
				id: payHolding.mandate,
				status: 'valid',
			};
		});

	return answerMollieList('mandates', customerMandates);
}

function answerMollie(requestMethod, requestPath, requestBody) {
	if (requestMethod === 'POST' && requestPath === '/v2/customers') {
		return createMollieCustomer(requestBody);
	}

	if (requestMethod === 'POST' && requestPath === '/v2/payments') {
		return createMolliePayment(requestBody);
	}

	if (requestMethod === 'POST' && requestPath === '/v2/sessions') {
		return MOLLIE_NO_SESSIONS;
	}

	const paymentMatch = /^\/v2\/payments\/(\w+)$/.exec(requestPath);

	if (paymentMatch !== null) {
		const payHolding = payHoldings.get(paymentMatch[1]);

		return payHolding === undefined
			? MOLLIE_NOT_FOUND
			: { code: 200, body: composeMolliePayment(payHolding) };
	}

	const subscriptionMatch = /^\/v2\/customers\/(\w+)\/subscriptions\/(\w+)(\/payments)?$/
		.exec(requestPath);

	// Mollie links no first payment to the subscription it starts, and the
	// fakes charge no recurring one: a subscription's payments are none.
	if (subscriptionMatch !== null) {
		return subscriptionMatch[3] === undefined
			? answerMollieSubscription(
				requestMethod,
				subscriptionMatch[1],
				subscriptionMatch[2],
			)
			: answerMollieList('payments', []);
	}

	const customerMatch = /^\/v2\/customers\/(\w+)\/(subscriptions|mandates|payments)$/
		.exec(requestPath);

	if (customerMatch === null) {
		return undefined;
	}

	const [, customerId, customerResource] = customerMatch;

	if (customerResource === 'mandates') {
		return answerMollieMandates(customerId);
	}

	if (customerResource === 'payments') {
		return answerMollieCustomerPayments(customerId);
	}

	if (requestMethod === 'POST') {
		return createMollieSubscription(customerId, requestBody);
	}

	return answerMollieList(
		'subscriptions',
		[...mollieSubscriptions.values()]
			.filter((mollieSubscription) => {
				return mollieSubscription.customer === customerId;
			})
			.map(composeMollieSubscription),
	);
}

function createStripeSession(requestText) {
	const sessionForm = parseStripeForm(requestText);

	if (sessionForm['ui_mode'] !== undefined) {
		return STRIPE_NO_ELEMENTS;
	}

	const pricePrefix = 'line_items[0][price_data]';

	const checkoutId = sessionForm[
		'subscription_data[metadata][directus_subscription]'
	];

	const sessionId = `cs_examples_${checkoutId}`;

	const payHolding = {
		provider: 'stripe',
		payment: sessionId,
		customer: `cus_examples_${checkoutId}`,
		subscription: `sub_examples_${checkoutId}`,
		email: sessionForm['customer_email'] ?? null,
		status: 'open',
		amount: (
			Number(sessionForm[`${pricePrefix}[unit_amount]`]) / 100
		).toFixed(2),
		unit_amount: Number(sessionForm[`${pricePrefix}[unit_amount]`]),
		currency: sessionForm[`${pricePrefix}[currency]`],
		interval: sessionForm[`${pricePrefix}[recurring][interval]`],
		interval_count: Number(
			sessionForm[`${pricePrefix}[recurring][interval_count]`] ?? 1,
		),
		description: sessionForm[`${pricePrefix}[product_data][name]`],
		redirect_url: sessionForm['success_url'],
		cancel_url: sessionForm['cancel_url'],
		metadata: { directus_subscription: checkoutId },
		pay_url: `${publicUrl}${PAY_PATH}${sessionId}`,
	};

	payHoldings.set(sessionId, payHolding);

	return { code: 200, body: composeStripeSession(payHolding) };
}

function answerStripeSubscription(subscriptionId, requestText) {
	const stripeSubscription = stripeSubscriptions.get(subscriptionId);

	if (stripeSubscription === undefined) {
		return STRIPE_NOT_FOUND;
	}

	const subscriptionForm = parseStripeForm(requestText);
	const cancelUpdate = subscriptionForm['cancel_at_period_end'];

	if (cancelUpdate === 'true' || cancelUpdate === 'false') {
		stripeSubscription.cancel_at_period_end = cancelUpdate === 'true';
	}

	return { code: 200, body: composeStripeSubscription(stripeSubscription) };
}

/** The checkout's paid session as the subscription's one invoice. */
function answerStripeInvoices(requestQuery) {
	const subscriptionId = new URLSearchParams(requestQuery)
		.get('subscription');

	const subscriptionInvoices = [...payHoldings.values()]
		.filter((payHolding) => {
			return payHolding.provider === 'stripe'
				&& payHolding.subscription === subscriptionId
				&& payHolding.status === 'paid';
		})
		.map((payHolding) => {
			const paidAt = Math.floor(Date.parse(payHolding.paid_at) / 1000);

			return {
				id: payHolding.payment.replace(/^cs_/, 'in_'),
				object: 'invoice',
				livemode: false,
				customer: payHolding.customer,
				subscription: payHolding.subscription,
				status: 'paid',
				total: payHolding.unit_amount,
				currency: payHolding.currency,
				created: paidAt,
				status_transitions: { paid_at: paidAt },
				hosted_invoice_url: null,
				invoice_pdf: null,
			};
		});

	return {
		code: 200,
		body: {
			object: 'list',
			url: '/v1/invoices',
			has_more: false,
			data: subscriptionInvoices,
		},
	};
}

function answerStripe(requestMethod, requestPath, requestQuery, requestText) {
	if (requestMethod === 'POST' && requestPath === '/v1/checkout/sessions') {
		return createStripeSession(requestText);
	}

	if (requestMethod === 'GET' && requestPath === '/v1/invoices') {
		return answerStripeInvoices(requestQuery);
	}

	const sessionMatch = /^\/v1\/checkout\/sessions\/(\w+)$/.exec(requestPath);

	if (sessionMatch !== null) {
		const payHolding = payHoldings.get(sessionMatch[1]);

		return payHolding === undefined
			? STRIPE_NOT_FOUND
			: { code: 200, body: composeStripeSession(payHolding) };
	}

	const subscriptionMatch = /^\/v1\/subscriptions\/(\w+)$/.exec(requestPath);

	return subscriptionMatch === null
		? undefined
		: answerStripeSubscription(subscriptionMatch[1], requestText);
}

async function sendWebhook(providerName, eventBody, signatureHeaders) {
	const webhookUrl = `${directusUrl}/subscriptions/webhooks/${providerName}`;

	const webhookResponse = await fetch(webhookUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...signatureHeaders },
		body: eventBody,
	});

	if (!webhookResponse.ok) {
		console.error(
			`Webhook ${JSON.stringify(webhookUrl)} answered`
			+ ` ${JSON.stringify(webhookResponse.status)}:`
			+ ` ${JSON.stringify(await webhookResponse.text())}`,
		);
	}
}

async function sendMollieEvent(eventType, paymentId) {
	const eventBody = JSON.stringify({ type: eventType, entityId: paymentId });

	const bodyDigest = createHmac('sha256', mollieSecret)
		.update(eventBody)
		.digest('hex');

	await sendWebhook('mollie', eventBody, {
		'x-mollie-signature': `sha256=${bodyDigest}`,
	});
}

async function sendStripeEvent(eventType, eventObject) {
	eventCount += 1;

	const eventBody = JSON.stringify({
		...RECORDED_STRIPE_EVENT,
		id: `evt_examples_${eventCount}`,
		created: Math.floor(Date.now() / 1000),
		type: eventType,
		data: { object: eventObject },
	});

	const signedAt = Math.floor(Date.now() / 1000);

	const bodyDigest = createHmac('sha256', stripeSecret)
		.update(`${signedAt}.${eventBody}`)
		.digest('hex');

	await sendWebhook('stripe', eventBody, {
		'Stripe-Signature': `t=${signedAt},v1=${bodyDigest}`,
	});
}

async function settleMolliePayment(payHolding, payOutcome) {
	payHolding.status = payOutcome;

	if (payOutcome === 'paid') {
		payHolding.paid_at = readPaidAt()
			.toISOString();
	}

	await sendMollieEvent(`payment.${payOutcome}`, payHolding.payment);

	return payHolding.redirect_url;
}

async function settleStripeSession(payHolding, payOutcome) {
	payHolding.status = payOutcome;

	if (payOutcome === 'paid') {
		payHolding.paid_at = readPaidAt()
			.toISOString();
	}

	if (payOutcome !== 'paid') {
		await sendStripeEvent(
			'checkout.session.expired',
			composeStripeSession(payHolding),
		);

		return payHolding.cancel_url;
	}

	const periodEnd = addMonths(
		readPaidAt(),
		payHolding.interval === 'year'
			? 12 * payHolding.interval_count
			: payHolding.interval_count,
	);

	const stripeSubscription = {
		subscription: payHolding.subscription,
		customer: payHolding.customer,
		status: 'active',
		currency: payHolding.currency,
		cancel_at_period_end: false,
		metadata: payHolding.metadata,
		unit_amount: payHolding.unit_amount,
		interval: payHolding.interval,
		interval_count: payHolding.interval_count,
		period_end: Math.floor(periodEnd.getTime() / 1000),
	};

	stripeSubscriptions.set(stripeSubscription.subscription, stripeSubscription);

	await sendStripeEvent(
		'customer.subscription.created',
		composeStripeSubscription(stripeSubscription),
	);

	return payHolding.redirect_url;
}

function composePayAnswer(payHolding) {
	return {
		provider: payHolding.provider,
		payment: payHolding.payment,
		status: payHolding.status,
		amount: payHolding.amount,
		currency: payHolding.currency.toUpperCase(),
		description: payHolding.description,
	};
}

async function answerPay(requestMethod, paymentId, requestText) {
	const payHolding = payHoldings.get(paymentId);

	if (payHolding === undefined) {
		return {
			code: 404,
			body: { error: `no payment ${JSON.stringify(paymentId)}` },
		};
	}

	if (requestMethod === 'GET') {
		return { code: 200, body: composePayAnswer(payHolding) };
	}

	const { outcome: payOutcome } = JSON.parse(requestText ?? '{}');

	if (!PAY_OUTCOMES.includes(payOutcome)) {
		return {
			code: 400,
			body: { error: `no outcome ${JSON.stringify(payOutcome ?? null)}` },
		};
	}

	if (payHolding.status !== 'open') {
		return {
			code: 409,
			body: {
				error: `payment ${JSON.stringify(paymentId)} is already`
					+ ` ${JSON.stringify(payHolding.status)}`,
			},
		};
	}

	const redirectUrl = payHolding.provider === 'mollie'
		? await settleMolliePayment(payHolding, payOutcome)
		: await settleStripeSession(payHolding, payOutcome);

	return { code: 200, body: { redirect_url: redirectUrl } };
}

async function answerRequest({
	requestMethod,
	requestPath,
	requestQuery,
	requestText,
	isJson,
}) {
	if (requestPath === '/providers-mode') {
		return answerProvidersMode(requestMethod, requestText);
	}

	const payMatch = /^\/pay\/(\w+)$/.exec(requestPath);

	if (payMatch !== null) {
		return await answerPay(requestMethod, payMatch[1], requestText);
	}

	if (requestPath.startsWith('/v2/')) {
		const requestBody = requestText !== null && isJson
			? JSON.parse(requestText)
			: requestText;

		return answerMollie(requestMethod, requestPath, requestBody);
	}

	if (requestPath.startsWith('/v1/')) {
		return answerStripe(requestMethod, requestPath, requestQuery, requestText);
	}

	return undefined;
}

const fakeServer = createServer(async (providerRequest, providerResponse) => {
	const requestUrl = new URL(providerRequest.url, 'http://provider');
	const requestPath = requestUrl.pathname;
	const requestQuery = requestUrl.search;
	const requestMethod = providerRequest.method;
	let rawText;

	// A caller gone mid-body rejects the read: unhandled, it ends the process.
	try {
		rawText = await readRequestText(providerRequest);
	}
	catch (readError) {
		console.error(
			`${requestMethod} ${JSON.stringify(requestPath)} body unread:`
			+ ` ${JSON.stringify(String(readError))}`,
		);

		return;
	}

	const requestText = rawText === '' || rawText === '{}'
		? null
		: rawText;

	const isRealCall = (requestPath.startsWith('/v1/')
		|| requestPath.startsWith('/v2/'))
		&& pickProvidersTarget({
			requestPath,
			requestQuery,
			requestText,
			providersMode,
			isRealAvailable,
		}) === 'real';

	if (isRealCall) {
		try {
			await forwardToRealProvider(providerRequest, rawText, providerResponse);
		}
		catch (forwardError) {
			console.error(
				`${requestMethod} ${JSON.stringify(requestPath)} to the real`
				+ ` provider failed: ${JSON.stringify(String(forwardError))}`,
			);

			providerResponse.writeHead(502);
			providerResponse.end();
		}

		return;
	}

	const isJson = (providerRequest.headers['content-type'] ?? '')
		.startsWith('application/json');

	let fakeAnswer;

	try {
		fakeAnswer = await answerRequest({
			requestMethod,
			requestPath,
			requestQuery,
			requestText,
			isJson,
		});
	}
	catch (answerError) {
		console.error(
			`${requestMethod} ${JSON.stringify(requestPath)} failed:`,
			answerError,
		);

		providerResponse.writeHead(500);
		providerResponse.end();

		return;
	}

	if (fakeAnswer === undefined) {
		console.error(
			`The fake providers have no answer for ${requestMethod}`
			+ ` ${JSON.stringify(requestPath)}`,
		);

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

fakeServer.listen(listeningPort, '127.0.0.1', () => {
	console.log(
		`Fake Stripe and Mollie listening on 127.0.0.1:${listeningPort},`
		+ ` providers mode ${JSON.stringify(providersMode)}`,
	);
});
