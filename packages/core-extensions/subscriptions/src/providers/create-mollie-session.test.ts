import { EventEmitter } from 'node:events';
import https from 'node:https';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createMollieSessionCreator } from './create-mollie-session.js';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('createMollieSessionCreator', () => {
	test.each([
		[201, '{"id":"ses_1","clientAccessToken":"token_1"}', null],
		[
			422,
			'{"status":422,"detail":"Sessions are in beta"}',
			'Mollie answered 422 to a session: "Sessions are in beta"',
		],
		[
			201,
			'{"id":"ses_1"}',
			'Mollie answered 201 to a session: "{\\"id\\":\\"ses_1\\"}"',
		],
	])('reads a %s %s', async (statusCode, responseText, sessionRefusal) => {
		const sentBodies: string[] = [];

		const requestSpy = vi.spyOn(https, 'request')
			.mockImplementation(((_requestOptions: unknown, onResponse: (
				sessionResponse: EventEmitter & { statusCode: number },
			) => void) => {
				const sessionRequest = new EventEmitter() as EventEmitter & {
					end: (requestBody: string) => void;
				};

				sessionRequest.end = (requestBody) => {
					sentBodies.push(requestBody);

					const sessionResponse = Object.assign(new EventEmitter(), {
						statusCode,
					});

					onResponse(sessionResponse);
					sessionResponse.emit('data', Buffer.from(responseText));
					sessionResponse.emit('end');
				};

				return sessionRequest;
			}) as never);

		const sessionToken = createMollieSessionCreator('test_key_1')({
			amount: { currency: 'EUR', value: '14.90' },
			description: 'Subscription 5',
			planName: 'Pro',
			redirectUrl: 'https://shop.example.com/ok',
			customerId: 'cst_5',
			metadata: { directus_subscription: '5' },
		});

		if (sessionRefusal === null) {
			await expect(sessionToken).resolves.toBe('token_1');
		}
		else {
			await expect(sessionToken).rejects.toThrow(new Error(sessionRefusal));
		}

		expect(requestSpy).toHaveBeenCalledWith(
			{
				method: 'POST',
				hostname: 'api.mollie.com',
				path: '/v2/sessions',
				headers: {
					'Authorization': 'Bearer test_key_1',
					'Content-Type': 'application/json',
					'Content-Length': 346,
				},
			},
			expect.any(Function),
		);

		expect(sentBodies.map((sentBody) => JSON.parse(sentBody))).toEqual([{
			amount: { currency: 'EUR', value: '14.90' },
			description: 'Subscription 5',
			lines: [{
				description: 'Pro',
				quantity: 1,
				unitPrice: { currency: 'EUR', value: '14.90' },
				totalAmount: { currency: 'EUR', value: '14.90' },
			}],
			redirectUrl: 'https://shop.example.com/ok',
			sequenceType: 'first',
			customerId: 'cst_5',
			metadata: { directus_subscription: '5' },
		}]);
	});

	test('rejects a request that cannot reach Mollie', async () => {
		vi.spyOn(https, 'request').mockImplementation((() => {
			const sessionRequest = new EventEmitter() as EventEmitter & {
				end: () => void;
			};

			sessionRequest.end = () => {
				sessionRequest.emit('error', new Error('getaddrinfo ENOTFOUND'));
			};

			return sessionRequest;
		}) as never);

		await expect(createMollieSessionCreator('test_key_1')({
			amount: { currency: 'EUR', value: '14.90' },
			description: 'Subscription 5',
			planName: 'Pro',
			redirectUrl: 'https://shop.example.com/ok',
			customerId: 'cst_5',
			metadata: { directus_subscription: '5' },
		})).rejects.toThrow(new Error('getaddrinfo ENOTFOUND'));
	});
});
