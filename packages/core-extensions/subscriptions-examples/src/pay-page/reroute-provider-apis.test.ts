import http from 'node:http';
import https from 'node:https';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { rerouteProviderApis } from './reroute-provider-apis.js';

// The reroute replaces https.request itself, past what a spy restores.
const realHttpsRequest = https.request;

afterEach(() => {
	vi.restoreAllMocks();
	https.request = realHttpsRequest;
});

describe('rerouteProviderApis', () => {
	test.each([
		['hostname', { hostname: 'api.mollie.com', path: '/v2/customers' }],
		['host', { host: 'api.stripe.com', path: '/v1/customers' }],
	])('sends a provider call named by its %s to the fake providers', (
		_hostField,
		requestOptions,
	) => {
		const httpRequest = vi.spyOn(http, 'request')
			.mockReturnValue('fake request' as never);

		vi.spyOn(https, 'request').mockReturnValue('real request' as never);
		rerouteProviderApis(8057);

		const answerCallback = vi.fn();

		expect(https.request({ ...requestOptions }, answerCallback))
			.toBe('fake request');

		expect(httpRequest).toHaveBeenCalledExactlyOnceWith({
			...requestOptions,
			agent: undefined,
			protocol: 'http:',
			host: '127.0.0.1',
			hostname: '127.0.0.1',
			port: 8057,
		}, answerCallback);
	});

	test.each([
		['another host', { hostname: 'example.com', path: '/' }],
		['a string', 'https://api.stripe.com/v1/customers'],
		['a URL', new URL('https://api.mollie.com/v2/customers')],
	])('leaves %s to https', (_requestKind, requestOptions) => {
		const httpRequest = vi.spyOn(http, 'request');

		const httpsRequest = vi.spyOn(https, 'request')
			.mockReturnValue('real request' as never);

		rerouteProviderApis(8057);

		expect(https.request(requestOptions as never)).toBe('real request');
		expect(httpsRequest).toHaveBeenCalledExactlyOnceWith(requestOptions);
		expect(httpRequest).not.toHaveBeenCalled();
	});

	test('reroutes once however many times the endpoint registers', () => {
		vi.spyOn(https, 'request');
		rerouteProviderApis(8057);

		const reroutedRequest = https.request;

		rerouteProviderApis(8058);

		expect(https.request).toBe(reroutedRequest);
	});
});
