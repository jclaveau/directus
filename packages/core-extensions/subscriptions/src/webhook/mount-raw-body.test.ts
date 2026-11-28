import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { mountRawBody, readMaxPayloadSize } from './mount-raw-body.js';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('mountRawBody', () => {
	test('reads a webhook body raw, whatever its content type', async () => {
		const expressApp = express();
		mountRawBody(expressApp, '1kb');
		expressApp.use(express.json());

		expressApp.post('/subscriptions/webhooks/stripe', (request, response) => {
			response.json({
				isRaw: Buffer.isBuffer(request.body),
				readBody: String(request.body),
			});
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

		expect(await webhookResponse.json())
			.toEqual({ isRaw: true, readBody: '{"id":"evt_1"}' });
	});

	test('leaves other paths to the JSON parser', async () => {
		const expressApp = express();
		mountRawBody(expressApp, '1kb');
		expressApp.use(express.json());

		expressApp.post('/items/orders', (request, response) => {
			response.json({ parsedBody: request.body });
		});

		const httpServer = expressApp.listen(0);
		const { port } = httpServer.address() as AddressInfo;

		const itemsResponse = await fetch(`http://127.0.0.1:${port}/items/orders`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{"id":1}',
		});

		httpServer.close();

		expect(await itemsResponse.json()).toEqual({ parsedBody: { id: 1 } });
	});

	test('refuses a body over the payload limit as an invalid payload', async () => {
		const expressApp = express();
		mountRawBody(expressApp, '4b');

		expressApp.use((
			payloadError: Error & { code?: string },
			_request: express.Request,
			response: express.Response,
			_next: express.NextFunction,
		) => {
			response.status(400)
				.json({ code: payloadError.code, message: payloadError.message });
		});

		const httpServer = expressApp.listen(0);
		const { port } = httpServer.address() as AddressInfo;

		const webhookResponse = await fetch(
			`http://127.0.0.1:${port}/subscriptions/webhooks/stripe`,
			{ method: 'POST', body: 'too long' },
		);

		httpServer.close();

		expect(await webhookResponse.json()).toEqual({
			code: 'INVALID_PAYLOAD',
			message: 'Invalid payload. request entity too large.',
		});
	});
});

describe('readMaxPayloadSize', () => {
	test('reads the size Directus caps JSON bodies at', () => {
		expect(readMaxPayloadSize({ MAX_PAYLOAD_SIZE: '1mb' })).toBe('1mb');
	});

	test('refuses a size that is not a string', () => {
		expect(() => readMaxPayloadSize({ MAX_PAYLOAD_SIZE: 1024 }))
			.toThrow(new Error('"MAX_PAYLOAD_SIZE" must be a string, got 1024'));
	});
});
