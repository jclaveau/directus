import { oneLine } from '@directus/utils';
import express, {
	type NextFunction,
	type Request,
	type Response,
} from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	readProvidersPort,
	refuseLiveKeys,
	subscriptionsExamplesEndpoint,
} from './endpoint.js';
import { composePayPage } from './pay-page/compose-pay-page.js';
import { rerouteProviderApis } from './pay-page/reroute-provider-apis.js';

type EndpointHandler = (
	router: express.Router,
	context: { env: Record<string, unknown> },
) => void;

vi.mock('./pay-page/reroute-provider-apis.js', () => {
	return { rerouteProviderApis: vi.fn() };
});

describe('refuseLiveKeys', () => {
	test.each([
		['SUBSCRIPTIONS_STRIPE_SECRET_KEY', 'sk_live_218'],
		['SUBSCRIPTIONS_STRIPE_SECRET_KEY', 'rk_live_218'],
		['SUBSCRIPTIONS_MOLLIE_API_KEY', 'live_218'],
	])('refuses %s set to %s', (variableName, providerKey) => {
		expect(() => refuseLiveKeys({ [variableName]: providerKey }))
			.toThrow(new Error(
				'"SUBSCRIPTIONS_EXAMPLES_FAKE_PROVIDERS" fakes Stripe and Mollie,'
				+ ' it refuses to start next to the live key'
				+ ` "${variableName}"`,
			));
	});

	test('accepts test keys', () => {
		expect(refuseLiveKeys({
			SUBSCRIPTIONS_STRIPE_SECRET_KEY: 'sk_test_examples',
			SUBSCRIPTIONS_MOLLIE_API_KEY: 'test_examples',
		})).toBeUndefined();
	});
});

describe('readProvidersPort', () => {
	test('reads the port', () => {
		expect(readProvidersPort({
			SUBSCRIPTIONS_EXAMPLES_PROVIDERS_PORT: 8057,
		})).toBe(8057);
	});

	test('refuses a missing port', () => {
		expect(() => readProvidersPort({}))
			.toThrow(new Error(
				'"SUBSCRIPTIONS_EXAMPLES_FAKE_PROVIDERS" needs the fake providers\''
				+ ' port in "SUBSCRIPTIONS_EXAMPLES_PROVIDERS_PORT", got null',
			));
	});
});

describe('composePayPage', () => {
	test(oneLine`
		names the provider and offers each outcome, escaping the description
	`, () => {
		const payPage = composePayPage({
			provider: 'stripe',
			payment: 'cs_examples_7',
			status: 'open',
			amount: '30.00',
			currency: 'EUR',
			description: 'Team <b>',
		});

		expect(payPage).toContain('<title>Fake Stripe page</title>');
		expect(payPage).toContain('Team &lt;b&gt;');
		expect(payPage).toContain('<button name="outcome" value="paid">paid</button>');

		expect(payPage)
			.toContain('<button name="outcome" value="failed">failed</button>');

		expect(payPage)
			.toContain('<button name="outcome" value="canceled">canceled</button>');
	});
});

type FakeAnswer = { status: number; body: Record<string, unknown> };

type ReceivedRequest = { method: string; url: string; body: string };

let fakeProviders: http.Server;
let examplesApp: http.Server;
let fakeAnswer: FakeAnswer;
let receivedRequests: ReceivedRequest[];
let examplesUrl: string;

async function listenOnFreePort(listeningServer: http.Server): Promise<number> {
	await new Promise<void>((resolveListen) => {
		listeningServer.listen(0, '127.0.0.1', resolveListen);
	});

	return (listeningServer.address() as AddressInfo).port;
}

async function startExamples(env: Record<string, unknown>): Promise<void> {
	const examplesRouter = express.Router();
	const examplesHandler = subscriptionsExamplesEndpoint
		.config as unknown as EndpointHandler;

	examplesHandler(examplesRouter, { env });

	const routedApp = express();

	routedApp.use(express.json());

	routedApp.use((request: Request, _response, next) => {
		const requestUser = request.header('x-user') ?? null;

		Object.assign(request, { accountability: { user: requestUser } });
		next();
	});

	routedApp.use(examplesRouter);

	routedApp.use((
		routeError: { status: number; code: string; message: string },
		_request: Request,
		response: Response,
		_next: NextFunction,
	) => {
		response
			.status(routeError.status)
			.json({ code: routeError.code, message: routeError.message });
	});

	examplesApp = http.createServer(routedApp);
	examplesUrl = `http://127.0.0.1:${await listenOnFreePort(examplesApp)}`;
}

async function startFakeProviders(): Promise<number> {
	fakeProviders = http.createServer((request, response) => {
		let requestBody = '';

		request.on('data', (bodyChunk) => {
			requestBody += bodyChunk;
		});

		request.on('end', () => {
			receivedRequests.push({
				method: request.method ?? '',
				url: request.url ?? '',
				body: requestBody,
			});

			response.writeHead(fakeAnswer.status, {
				'Content-Type': 'application/json',
			});

			response.end(JSON.stringify(fakeAnswer.body));
		});
	});

	return await listenOnFreePort(fakeProviders);
}

describe('subscriptionsExamplesEndpoint', () => {
	beforeEach(async () => {
		receivedRequests = [];
		fakeAnswer = { status: 200, body: {} };

		await startExamples({
			SUBSCRIPTIONS_EXAMPLES_FAKE_PROVIDERS: true,
			SUBSCRIPTIONS_EXAMPLES_PROVIDERS_PORT: await startFakeProviders(),
		});
	});

	afterEach(() => {
		examplesApp.close();
		fakeProviders.close();
		vi.clearAllMocks();
	});

	test('reroutes the provider APIs to the fake providers\' port', () => {
		expect(rerouteProviderApis).toHaveBeenCalledExactlyOnceWith(
			(fakeProviders.address() as AddressInfo).port,
		);
	});

	test('serves the pay page of a payment the fake providers hold', async () => {
		fakeAnswer = {
			status: 200,
			body: {
				provider: 'mollie',
				payment: 'tr_examples_1',
				status: 'open',
				amount: '25.00',
				currency: 'EUR',
				description: 'Team',
			},
		};

		const pageResponse = await fetch(`${examplesUrl}/pay/tr_examples_1`);

		expect({
			status: pageResponse.status,
			policy: pageResponse.headers.get('content-security-policy'),
			page: await pageResponse.text(),
		}).toEqual({
			status: 200,
			policy: "default-src 'none'; style-src 'unsafe-inline'; form-action *",
			page: composePayPage({
				provider: 'mollie',
				payment: 'tr_examples_1',
				status: 'open',
				amount: '25.00',
				currency: 'EUR',
				description: 'Team',
			}),
		});

		expect(receivedRequests)
			.toEqual([{ method: 'GET', url: '/pay/tr_examples_1', body: '' }]);
	});

	test('answers 404 for a payment the fake providers do not hold', async () => {
		fakeAnswer = { status: 404, body: { error: 'no such payment' } };

		const pageResponse = await fetch(`${examplesUrl}/pay/tr_missing`);

		expect({
			status: pageResponse.status,
			body: await pageResponse.json(),
		}).toEqual({
			status: 404,
			body: {
				code: 'ROUTE_NOT_FOUND',
				message: 'The fake providers hold no payment "tr_missing".',
			},
		});
	});

	test('posts the picked outcome and redirects to the shop', async () => {
		fakeAnswer = {
			status: 200,
			body: { redirect_url: 'http://shop.example/admin/subscriptions' },
		};

		const payResponse = await fetch(`${examplesUrl}/pay/tr_examples_1`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'outcome=paid',
			redirect: 'manual',
		});

		expect({
			status: payResponse.status,
			location: payResponse.headers.get('location'),
		}).toEqual({
			status: 302,
			location: 'http://shop.example/admin/subscriptions',
		});

		expect(receivedRequests).toEqual([{
			method: 'POST',
			url: '/pay/tr_examples_1',
			body: '{"outcome":"paid"}',
		}]);
	});

	test('refuses an outcome the fake page does not offer', async () => {
		const payResponse = await fetch(`${examplesUrl}/pay/tr_examples_1`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'outcome=refunded',
		});

		expect({
			status: payResponse.status,
			body: await payResponse.json(),
		}).toEqual({
			status: 400,
			body: {
				code: 'INVALID_PAYLOAD',
				message: 'Invalid payload. "outcome" is "paid", "failed" or'
					+ ' "canceled", got "refunded".',
			},
		});

		expect(receivedRequests).toEqual([]);
	});

	test('refuses a missing outcome', async () => {
		const payResponse = await fetch(`${examplesUrl}/pay/tr_examples_1`, {
			method: 'POST',
		});

		expect({
			status: payResponse.status,
			body: await payResponse.json(),
		}).toEqual({
			status: 400,
			body: {
				code: 'INVALID_PAYLOAD',
				message: 'Invalid payload. "outcome" is "paid", "failed" or'
					+ ' "canceled", got null.',
			},
		});
	});

	test('passes on the fake providers\' refusal of a payment', async () => {
		fakeAnswer = { status: 409, body: { error: 'already paid' } };

		const payResponse = await fetch(`${examplesUrl}/pay/tr_examples_1`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'outcome=failed',
		});

		expect({
			status: payResponse.status,
			body: await payResponse.json(),
		}).toEqual({
			status: 400,
			body: {
				code: 'INVALID_PAYLOAD',
				message: 'Invalid payload. the fake providers refused payment'
					+ ' "tr_examples_1": "already paid".',
			},
		});
	});

	test.each(['GET', 'PUT'])(
		'refuses %s /providers-mode to nobody',
		async (requestMethod) => {
			const modeResponse = await fetch(`${examplesUrl}/providers-mode`, {
				method: requestMethod,
			});

			expect({
				status: modeResponse.status,
				body: await modeResponse.json(),
			}).toEqual({
				status: 403,
				body: {
					code: 'FORBIDDEN',
					message: 'You don\'t have permission to access this.',
				},
			});

			expect(receivedRequests).toEqual([]);
		},
	);

	test('reads the providers mode for a signed-in user', async () => {
		fakeAnswer = { status: 200, body: { mode: 'fake', real_available: false } };

		const modeResponse = await fetch(`${examplesUrl}/providers-mode`, {
			headers: { 'x-user': 'user-1' },
		});

		expect(await modeResponse.json())
			.toEqual({ data: { mode: 'fake', real_available: false } });

		expect(receivedRequests)
			.toEqual([{ method: 'GET', url: '/providers-mode', body: '' }]);
	});

	test('switches the providers mode for a signed-in user', async () => {
		fakeAnswer = { status: 200, body: { mode: 'real', real_available: true } };

		const modeResponse = await fetch(`${examplesUrl}/providers-mode`, {
			method: 'PUT',
			headers: { 'x-user': 'user-1', 'Content-Type': 'application/json' },
			body: '{"mode":"real"}',
		});

		expect(await modeResponse.json())
			.toEqual({ data: { mode: 'real', real_available: true } });

		expect(receivedRequests).toEqual([{
			method: 'PUT',
			url: '/providers-mode',
			body: '{"mode":"real"}',
		}]);
	});

	test('sends a null mode when the switch names none', async () => {
		fakeAnswer = { status: 400, body: { error: 'mode is "fake" or "real"' } };

		const modeResponse = await fetch(`${examplesUrl}/providers-mode`, {
			method: 'PUT',
			headers: { 'x-user': 'user-1' },
		});

		expect({
			status: modeResponse.status,
			body: await modeResponse.json(),
		}).toEqual({
			status: 400,
			body: {
				code: 'INVALID_PAYLOAD',
				message: 'Invalid payload. the providers mode stays as it was:'
					+ ' "mode is \\"fake\\" or \\"real\\"".',
			},
		});

		expect(receivedRequests).toEqual([{
			method: 'PUT',
			url: '/providers-mode',
			body: '{"mode":null}',
		}]);
	});
});

describe('subscriptionsExamplesEndpoint without the fake providers', () => {
	test('registers no route', () => {
		const examplesRouter = express.Router();
		const examplesHandler = subscriptionsExamplesEndpoint
			.config as unknown as EndpointHandler;

		examplesHandler(examplesRouter, {
			env: { SUBSCRIPTIONS_EXAMPLES_FAKE_PROVIDERS: false },
		});

		expect(examplesRouter.stack).toEqual([]);
		expect(rerouteProviderApis).not.toHaveBeenCalled();
	});
});
