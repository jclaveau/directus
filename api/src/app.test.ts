import { useEnv } from '@directus/env';
import { Router } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import createApp from './app.js';
import { resolvedRateLimiterCharge } from './middleware/rate-limiter-ip.js';
import { validateChoiceEnv } from './utils/validate-env.js';

vi.mock('./database', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	isInstalled: vi.fn(),
	validateDatabaseConnection: vi.fn(),
	validateDatabaseExtensions: vi.fn(),
	outstandingMigrationsOrExit: vi.fn().mockResolvedValue([]),
}));

vi.mock('./telemetry/index.js');

// This is required because logger uses global env which is imported before the tests run. Can be
// reduce to just mock the file when logger is also using useLogger everywhere @TODO
vi.mock('@directus/env', () => ({
	useEnv: vi.fn().mockReturnValue({
		STORAGE_LOCATIONS: ['local'],
		EMAIL_TEMPLATES_PATH: './templates',
	}),
}));

const mockGetEndpointRouter = vi.fn().mockReturnValue(Router());
const mockGetEmbeds = vi.fn().mockReturnValue({ head: '', body: '' });

vi.mock('./extensions', () => ({
	getExtensionManager: vi.fn().mockImplementation(() => {
		return {
			initialize: vi.fn(),
			getEndpointRouter: mockGetEndpointRouter,
			getEmbeds: mockGetEmbeds,
		};
	}),
}));

vi.mock('./flows', () => ({
	getFlowManager: vi.fn().mockImplementation(() => {
		return {
			initialize: vi.fn(),
		};
	}),
}));

vi.mock('./middleware/schema', () => ({
	default: Router(),
}));

vi.mock('./auth', () => ({
	registerAuthProviders: vi.fn(),
}));

vi.mock('./webhooks', () => ({
	init: vi.fn(),
}));

vi.mock('./utils/validate-env.js');

// Both are named functions so the layers they register are identifiable by name in
// the middleware stack — which is how the limiter's position is asserted below.
vi.mock('./middleware/rate-limiter-ip.js', () => {
	return {
		default: function rateLimiterIp(_req: any, _res: any, next: any) {
			next();
		},
		resolvedRateLimiterCharge: vi.fn(),
	};
});

vi.mock('./middleware/cache.js', () => {
	return {
		default: function checkCache(_req: any, _res: any, next: any) {
			next();
		},
	};
});

const BASE_ENV = {
	SECRET: 'abcdef',
	SERVE_APP: 'true',
	PUBLIC_URL: 'http://localhost:8055/directus',
	TELEMETRY: 'false',
	LOG_STYLE: 'raw',
	STORAGE_LOCATIONS: ['local'],
	ROBOTS_TXT: 'User-agent: *\nDisallow: /',
	ROOT_REDIRECT: './admin',
	IP_TRUST_PROXY: true,
};

beforeEach(() => {
	vi.mocked(useEnv).mockReturnValue({ ...BASE_ENV });
});

afterEach(() => {
	vi.clearAllMocks();
});

const request = async (path: string = '', init: RequestInit = {}) => {
	const app = await createApp();
	const server = http.createServer(app);
	server.listen(0);
	const address = server.address() as AddressInfo;
	const baseUrl = `http://127.0.0.1:${address.port}`;

	const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual', ...init });

	server.close();

	return response;
};

describe('createApp', async () => {
	describe('Content Security Policy', () => {
		test('Should set content-security-policy header by default', async () => {
			const response = await request();

			expect(response.headers.has('content-security-policy')).toBe(true);
		});
	});

	describe('Root Redirect', () => {
		test('Should redirect root path by default', async () => {
			const response = await request();

			expect(response.status).toEqual(302);
		});
	});

	describe('robots.txt file', () => {
		test('Should respond with default robots.txt content', async () => {
			const response = await request('/robots.txt');
			const body = await response.text();

			expect(body).toEqual('User-agent: *\nDisallow: /');
		});
	});

	describe('Admin App', () => {
		test('Should set <base /> tag href to public url with admin relative path', async () => {
			const response = await request('/admin');
			const body = await response.text();

			expect(body).toEqual(expect.stringContaining(`<base href="/directus/admin/" />`));
		});

		test('Should remove <embed-head /> and <embed-body /> tags when there are no custom embeds', async () => {
			mockGetEmbeds.mockReturnValueOnce({ head: '', body: '' });

			const response = await request('/admin');
			const body = await response.text();

			expect(body).not.toEqual(expect.stringContaining(`<embed-head />`));
			expect(body).not.toEqual(expect.stringContaining(`<embed-body />`));
		});

		test('Should replace <embed-head /> tag with custom embed head', async () => {
			const mockEmbedHead = '<!-- Test Embed Head -->';
			mockGetEmbeds.mockReturnValueOnce({ head: mockEmbedHead, body: '' });

			const response = await request('/admin');
			const body = await response.text();

			expect(body).toEqual(expect.stringContaining(mockEmbedHead));
		});

		test('Should replace <embed-body /> tag with custom embed body', async () => {
			const mockEmbedBody = '<!-- Test Embed Body -->';
			mockGetEmbeds.mockReturnValueOnce({ head: '', body: mockEmbedBody });

			const response = await request('/admin');
			const body = await response.text();

			expect(body).toEqual(expect.stringContaining(mockEmbedBody));
		});
	});

	describe('Server ping endpoint', () => {
		test('Should respond with pong', async () => {
			const response = await request('/server/ping');
			const body = await response.text();

			expect(body).toEqual('pong');
		});
	});

	describe('Custom Endpoints', () => {
		test('Should not contain route for custom endpoint', async () => {
			const testRoute = '/custom-endpoint-to-test';

			const response = await request(testRoute);
			const body = await response.json();

			expect(body).toEqual({
				errors: [
					{
						extensions: {
							code: 'ROUTE_NOT_FOUND',
							path: '/custom-endpoint-to-test',
						},
						message: `Route ${testRoute} doesn't exist.`,
					},
				],
			});
		});

		test('Should contain route for custom endpoint', async () => {
			const testRoute = '/custom-endpoint-to-test';
			const testResponse = { key: 'value' };
			const mockRouter = Router();

			mockRouter.use(testRoute, (_, res) => {
				res.json(testResponse);
			});

			mockGetEndpointRouter.mockReturnValueOnce(mockRouter);

			const response = await request(testRoute);
			const body = await response.json();

			expect(body).toEqual(testResponse);
		});
	});

	test('validates DEFAULT_MUTATION_BATCHING at boot', async () => {
		await createApp();

		expect(validateChoiceEnv).toHaveBeenCalledWith('DEFAULT_MUTATION_BATCHING', [
			'minimizeMutations',
			'preserveMutationOrder',
			'disableBatching',
		]);
	});

	// What a rate-limit token buys is decided by where the limiter is registered, so
	// the contract worth pinning is the position itself rather than any response.
	describe('Rate limiter charge', () => {
		const middlewareNames = async () => {
			const app = await createApp();

			return (app as any)._router.stack.map((layer: any) => layer.name);
		};

		test('registers the limiter below the cache by default', async () => {
			vi.mocked(useEnv).mockReturnValue({ ...BASE_ENV, RATE_LIMITER_ENABLED: true });
			vi.mocked(resolvedRateLimiterCharge).mockReturnValue('cache-misses');

			const names = await middlewareNames();

			// A cache HIT answers without calling `next()`, so sitting after the cache is
			// what makes a hit cost nothing.
			expect(names).toContain('rateLimiterIp');

			expect(names.indexOf('rateLimiterIp'))
				.toBeGreaterThan(names.indexOf('checkCache'));
		});

		test('registers the limiter above the cache for every-request', async () => {
			vi.mocked(useEnv).mockReturnValue({ ...BASE_ENV, RATE_LIMITER_ENABLED: true });
			vi.mocked(resolvedRateLimiterCharge).mockReturnValue('every-request');

			const names = await middlewareNames();

			expect(names).toContain('rateLimiterIp');

			expect(names.indexOf('rateLimiterIp'))
				.toBeLessThan(names.indexOf('checkCache'));
		});

		test('registers the limiter nowhere when it is disabled', async () => {
			const names = await middlewareNames();

			// Neither call site matches, and the charge is never even resolved — an
			// unparseable value must not break a deployment that runs no limiter.
			expect(names).not.toContain('rateLimiterIp');
			expect(resolvedRateLimiterCharge).not.toHaveBeenCalled();
		});
	});

	describe('Marketplace', () => {
		afterEach(() => {
			vi.unstubAllEnvs();
		});

		test('refuses a registry read in production', async () => {
			vi.stubEnv('NODE_ENV', 'production');

			const response = await request('/extensions/registry?search=a');

			expect(response.status).toBe(404);

			expect(await response.json()).toEqual({
				errors: [
					{
						extensions: {
							code: 'ROUTE_NOT_FOUND',
							path: '/extensions/registry',
						},
						message: "Route /extensions/registry doesn't exist.",
					},
				],
			});
		});

		// Enabling or disabling reloads the extensions in place: in production they
		// change only with a deploy.
		test('refuses an extension update in production', async () => {
			vi.stubEnv('NODE_ENV', 'production');

			const response = await request(
				'/extensions/9f2b8c1e-4d3a-4b5c-8e7f-1a2b3c4d5e6f',
				{
					method: 'PATCH',
					body: '{}',
					headers: { 'content-type': 'application/json' },
				},
			);

			expect(response.status).toBe(404);

			expect(await response.json()).toEqual({
				errors: [
					{
						extensions: {
							code: 'ROUTE_NOT_FOUND',
							path: '/extensions/9f2b8c1e-4d3a-4b5c-8e7f-1a2b3c4d5e6f',
						},
						message: 'Route /extensions/9f2b8c1e-4d3a-4b5c-8e7f-1a2b3c4d5e6f'
							+ " doesn't exist.",
					},
				],
			});
		});

		// A gate below the cache lets a registry answer cached by a replica outside
		// production through until its TTL.
		test('registers the production gate above the cache', async () => {
			const app = await createApp();

			const names = (app as any)._router.stack.map((layer: any) => layer.name);

			expect(names).toContain('refuseExtensionChangeInProduction');

			expect(names.indexOf('refuseExtensionChangeInProduction'))
				.toBeLessThan(names.indexOf('checkCache'));
		});
	});

	describe('Not Found Handler', () => {
		test('Should return ROUTE_NOT_FOUND error when a route does not exist', async () => {
			const testRoute = '/this-route-does-not-exist';

			const response = await request(testRoute);
			const body = await response.json();

			expect(body).toEqual({
				errors: [
					{
						extensions: {
							code: 'ROUTE_NOT_FOUND',
							path: '/this-route-does-not-exist',
						},
						message: `Route ${testRoute} doesn't exist.`,
					},
				],
			});
		});
	});
});
