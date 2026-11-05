import type { AddressInfo } from 'node:net';
import { ForbiddenError } from '@directus/errors';
import express from 'express';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cancelOwnSubscription } from './cancel/cancel-own-subscription.js';
import { subscriptionsEndpoint } from './endpoint.js';
import { receiveWebhook } from './webhook/receive-webhook.js';

vi.mock('./cancel/cancel-own-subscription.js');
vi.mock('./webhook/receive-webhook.js');

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetAllMocks();
});

describe('subscriptionsEndpoint', () => {
	test('mounts at /subscriptions', () => {
		expect(subscriptionsEndpoint.name).toBe('subscriptions');
	});

	test('acknowledges a webhook once its sync is queued', async () => {
		vi.mocked(receiveWebhook)
			.mockResolvedValue(undefined);

		const expressApp = express();
		const subscriptionsRouter = express.Router();
		expressApp.use(express.raw({ type: () => true }));
		expressApp.use('/subscriptions', subscriptionsRouter);

		(subscriptionsEndpoint.config as (...args: unknown[]) => void)(
			subscriptionsRouter,
			{ env: {}, database: 'database' },
		);

		const httpServer = expressApp.listen(0);
		const { port } = httpServer.address() as AddressInfo;

		const webhookResponse = await fetch(
			`http://127.0.0.1:${port}/subscriptions/webhooks/mollie`,
			{
				method: 'POST',
				headers: { 'x-mollie-test': '1' },
				body: 'id=tr_1',
			},
		);

		httpServer.close();

		expect(webhookResponse.status).toBe(200);

		expect(receiveWebhook).toHaveBeenCalledWith({
			database: 'database',
			enabledProviders: new Map(),
			providerName: 'mollie',
			rawBody: Buffer.from('id=tr_1'),
			requestHeaders: expect.objectContaining({ 'x-mollie-test': '1' }),
		});
	});

	test('passes a refused webhook to the error handler', async () => {
		vi.mocked(receiveWebhook)
			.mockRejectedValue(new ForbiddenError());

		const expressApp = express();
		const subscriptionsRouter = express.Router();
		expressApp.use(express.raw({ type: () => true }));
		expressApp.use('/subscriptions', subscriptionsRouter);

		(subscriptionsEndpoint.config as (...args: unknown[]) => void)(
			subscriptionsRouter,
			{ env: {}, database: 'database' },
		);

		expressApp.use((
			routeError: Error & { status: number },
			_request: express.Request,
			response: express.Response,
			_next: express.NextFunction,
		) => {
			response.status(routeError.status)
				.json({ message: routeError.message });
		});

		const httpServer = expressApp.listen(0);
		const { port } = httpServer.address() as AddressInfo;

		const webhookResponse = await fetch(
			`http://127.0.0.1:${port}/subscriptions/webhooks/mollie`,
			{ method: 'POST', body: 'id=tr_1' },
		);

		httpServer.close();

		expect(webhookResponse.status).toBe(403);

		expect(await webhookResponse.json()).toEqual({
			message: 'You don\'t have permission to access this.',
		});
	});

	test('refuses a webhook body that was not read raw', async () => {
		const expressApp = express();
		const subscriptionsRouter = express.Router();
		expressApp.use(express.json());
		expressApp.use('/subscriptions', subscriptionsRouter);

		(subscriptionsEndpoint.config as (...args: unknown[]) => void)(
			subscriptionsRouter,
			{ env: {}, database: 'database' },
		);

		expressApp.use((
			routeError: Error & { status: number },
			_request: express.Request,
			response: express.Response,
			_next: express.NextFunction,
		) => {
			response.status(routeError.status)
				.json({ message: routeError.message });
		});

		const httpServer = expressApp.listen(0);
		const { port } = httpServer.address() as AddressInfo;

		const webhookResponse = await fetch(
			`http://127.0.0.1:${port}/subscriptions/webhooks/stripe`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"id":"evt_1"}',
			},
		);

		httpServer.close();

		expect(webhookResponse.status).toBe(400);

		expect(await webhookResponse.json()).toEqual({
			message: 'Invalid payload. the webhook body was not read raw.',
		});

		expect(receiveWebhook).not.toHaveBeenCalled();
	});

	test('cancels the requesting user\'s subscription', async () => {
		vi.mocked(cancelOwnSubscription)
			.mockResolvedValue(undefined);

		const expressApp = express();
		const subscriptionsRouter = express.Router();

		expressApp.use((request, _response, next) => {
			Object.assign(request, { accountability: { user: 'user-1' } });
			next();
		});

		expressApp.use('/subscriptions', subscriptionsRouter);

		(subscriptionsEndpoint.config as (...args: unknown[]) => void)(
			subscriptionsRouter,
			{ env: {}, database: 'database' },
		);

		const httpServer = expressApp.listen(0);
		const { port } = httpServer.address() as AddressInfo;

		const cancelResponse = await fetch(
			`http://127.0.0.1:${port}/subscriptions/cancel`,
			{ method: 'POST' },
		);

		httpServer.close();

		expect(cancelResponse.status).toBe(204);

		expect(cancelOwnSubscription).toHaveBeenCalledWith({
			database: 'database',
			enabledProviders: new Map(),
			userId: 'user-1',
		});
	});

	test('cancels as nobody without accountability', async () => {
		vi.mocked(cancelOwnSubscription)
			.mockRejectedValue(new ForbiddenError());

		const expressApp = express();
		const subscriptionsRouter = express.Router();
		expressApp.use('/subscriptions', subscriptionsRouter);

		(subscriptionsEndpoint.config as (...args: unknown[]) => void)(
			subscriptionsRouter,
			{ env: {}, database: 'database' },
		);

		expressApp.use((
			routeError: Error & { status: number },
			_request: express.Request,
			response: express.Response,
			_next: express.NextFunction,
		) => {
			response.status(routeError.status)
				.end();
		});

		const httpServer = expressApp.listen(0);
		const { port } = httpServer.address() as AddressInfo;

		const cancelResponse = await fetch(
			`http://127.0.0.1:${port}/subscriptions/cancel`,
			{ method: 'POST' },
		);

		httpServer.close();

		expect(cancelResponse.status).toBe(403);

		expect(cancelOwnSubscription).toHaveBeenCalledWith({
			database: 'database',
			enabledProviders: new Map(),
			userId: null,
		});
	});
});
