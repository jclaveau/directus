import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const env: Record<string, any> = {
	CACHE_ENABLED: true,
	CACHE_STATUS_HEADER: 'x-cache-status',
};

vi.mock('@directus/env', () => ({ useEnv: () => env }));

const mocks = vi.hoisted(() => {
	return {
		mockCache: {},
		getCacheValue: vi.fn(),
		warn: vi.fn(),
		shouldSkipCache: vi.fn(),
		getCacheKey: vi.fn(),
	};
});

const { getCacheValue, warn, shouldSkipCache, getCacheKey } = mocks;

vi.mock('../cache.js', () => {
	return {
		getCache: () => ({ cache: mocks.mockCache }),
		getCacheValue: mocks.getCacheValue,
	};
});

vi.mock('../logger/index.js', () => ({ useLogger: () => ({ warn: mocks.warn }) }));

vi.mock('../utils/get-cache-headers.js', () => {
	return { getCacheControlHeader: () => 'max-age=300' };
});

vi.mock('../utils/get-cache-key.js', () => ({ getCacheKey: mocks.getCacheKey }));

vi.mock('../utils/should-skip-cache.js', () => {
	return { shouldSkipCache: mocks.shouldSkipCache };
});

import checkCacheMiddleware from './cache.js';

const next = vi.fn();

function makeRes() {
	return {
		setHeader: vi.fn(),
		json: vi.fn().mockReturnThis(),
	} as unknown as Response;
}

function makeReq() {
	return {
		method: 'GET',
		originalUrl: '/items/articles',
	} as unknown as Request;
}

// A cache HIT: payload + expiry sibling exist; `tags` seeds the `__tags` sibling
// (undefined = absent). `tagsThrows` makes the sibling read reject (hits the catch).
function primeHit(tags?: unknown, tagsThrows = false) {
	getCacheValue.mockImplementation(async (_cache: unknown, key: string) => {
		if (key === 'cache-key') {
			return { data: [1] };
		}

		if (key === 'cache-key__expires_at') {
			return { exp: Date.now() + 1000 };
		}

		if (key === 'cache-key__tags') {
			if (tagsThrows) {
				throw new Error('boom');
			}

			if (tags === undefined) {
				return undefined;
			}

			return { tags };
		}

		return undefined;
	});
}

beforeEach(() => {
	env['CACHE_ENABLED'] = true;
	delete env['CACHE_TAGS_HEADER'];
	shouldSkipCache.mockReturnValue(false);
	getCacheKey.mockResolvedValue('cache-key');
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('checkCacheMiddleware', () => {
	test('HIT emits the __tags sibling under CACHE_TAGS_HEADER', async () => {
		env['CACHE_TAGS_HEADER'] = 'X-Scoped-Cache-Tags';
		primeHit('articles:owner=U1');

		const res = makeRes();

		await checkCacheMiddleware(makeReq(), res, next);

		expect(res.setHeader).toHaveBeenCalledWith(
			'X-Scoped-Cache-Tags',
			'articles:owner=U1',
		);

		expect(res.json).toHaveBeenCalledWith({ data: [1] });
	});

	test('HIT emits no tags header when the __tags sibling is empty', async () => {
		env['CACHE_TAGS_HEADER'] = 'X-Scoped-Cache-Tags';
		primeHit(undefined);

		const res = makeRes();

		await checkCacheMiddleware(makeReq(), res, next);

		const names = vi.mocked(res.setHeader).mock.calls.map((call) => call[0]);
		expect(names).not.toContain('X-Scoped-Cache-Tags');
	});

	test('a __tags read failure is caught and logged, not thrown', async () => {
		env['CACHE_TAGS_HEADER'] = 'X-Scoped-Cache-Tags';
		primeHit(undefined, true);

		const res = makeRes();

		await checkCacheMiddleware(makeReq(), res, next);

		expect(warn).toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith({ data: [1] });
	});

	test('HIT without CACHE_TAGS_HEADER emits no tags header', async () => {
		primeHit('articles');

		const res = makeRes();

		await checkCacheMiddleware(makeReq(), res, next);

		expect(res.json).toHaveBeenCalledWith({ data: [1] });

		const names = vi.mocked(res.setHeader).mock.calls.map((call) => call[0]);
		expect(names).not.toContain('X-Scoped-Cache-Tags');
	});
});
