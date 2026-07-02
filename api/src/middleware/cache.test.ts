import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getCacheValue } from '../cache.js';

const env: Record<string, any> = {
	CACHE_ENABLED: true,
	CACHE_TYPES: ['api', 'service'],
	CACHE_STATUS_HEADER: 'x-cache-status',
};

vi.mock('@directus/env', () => ({ useEnv: () => env }));

const mockCache = { get: vi.fn(), set: vi.fn() };

vi.mock('../cache.js', () => {
	return {
		getCache: () => ({ cache: mockCache }),
		getCacheValue: vi.fn(),
	};
});

vi.mock('../logger/index.js', () => ({ useLogger: () => ({ warn: vi.fn() }) }));
vi.mock('../utils/should-skip-cache.js', () => ({ shouldSkipCache: () => false }));

vi.mock('../utils/get-cache-key.js', () => {
	return { getCacheKey: vi.fn().mockResolvedValue('cache-key') };
});

vi.mock('../utils/get-cache-headers.js', () => {
	return { getCacheControlHeader: () => 'max-age=300' };
});

const { default: checkCacheMiddleware } = await import('./cache.js');

function makeReq(overrides = {}): Request {
	return {
		method: 'GET',
		originalUrl: '/items/articles',
		accountability: null,
		...overrides,
	} as unknown as Request;
}

function makeRes(): Response {
	return { setHeader: vi.fn(), json: vi.fn() } as unknown as Response;
}

beforeEach(() => {
	env['CACHE_ENABLED'] = true;
	env['CACHE_TYPES'] = ['api', 'service'];
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('checkCache middleware', () => {
	test('CACHE_ENABLED === false passes through without reading the cache', async () => {
		env['CACHE_ENABLED'] = false;
		const next = vi.fn();

		await checkCacheMiddleware(makeReq(), makeRes(), next);

		expect(next).toHaveBeenCalledOnce();
		expect(vi.mocked(getCacheValue)).not.toHaveBeenCalled();
	});

	test('CACHE_TYPES without "api" passes through without reading the cache', async () => {
		env['CACHE_TYPES'] = ['service'];
		const next = vi.fn();

		await checkCacheMiddleware(makeReq(), makeRes(), next);

		expect(next).toHaveBeenCalledOnce();
		expect(vi.mocked(getCacheValue)).not.toHaveBeenCalled();
	});

	test('serves a cached hit as json', async () => {
		vi.mocked(getCacheValue)
			.mockResolvedValueOnce({ data: [{ id: 1 }] })
			.mockResolvedValueOnce({ exp: 4102444800000 });

		const res = makeRes();
		const next = vi.fn();

		await checkCacheMiddleware(makeReq(), res, next);

		expect(res.json).toHaveBeenCalledWith({ data: [{ id: 1 }] });
		expect(res.setHeader).toHaveBeenCalledWith('x-cache-status', 'HIT');
		expect(next).not.toHaveBeenCalled();
	});

	test('passes through on a miss', async () => {
		vi.mocked(getCacheValue).mockResolvedValueOnce(undefined);

		const res = makeRes();
		const next = vi.fn();

		await checkCacheMiddleware(makeReq(), res, next);

		expect(next).toHaveBeenCalledOnce();
		expect(res.setHeader).toHaveBeenCalledWith('x-cache-status', 'MISS');
	});
});
