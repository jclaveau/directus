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
		responseMetricInc: vi.fn(),
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

vi.mock('../metrics/index.js', () => {
	return {
		useMetrics: () => {
			return {
				getCacheResponseMetric: () => {
					return { inc: mocks.responseMetricInc };
				},
			};
		},
	};
});

vi.mock('../utils/get-cache-headers.js', () => {
	return { getCacheControlHeader: () => 'max-age=300' };
});

vi.mock('../utils/get-cache-key.js', () => ({ getCacheKey: mocks.getCacheKey }));

vi.mock('../utils/should-skip-cache.js', () => {
	return { shouldSkipCache: mocks.shouldSkipCache };
});

// Factory-stub the telemetry collaborator (no real import) so its `getDatabase`
// chain doesn't eagerly load `register-locations`, which calls the env mock before
// this file's `env` is initialised. cacheStatsActive→false skips all capture here.
vi.mock('../cache-events.js', () => {
	return {
		// captureCacheHit is `.catch()`ed in the middleware, so it must be thenable.
		cacheStatsActive: vi.fn(() => false),
		captureCacheHit: vi.fn(() => Promise.resolve()),
		captureCacheMiss: vi.fn(() => Promise.resolve()),
		captureCacheAnomaly: vi.fn(() => Promise.resolve()),
		readCacheMissGap: vi.fn(() => Promise.resolve(null)),
	};
});

import checkCacheMiddleware from './cache.js';
import {
	cacheStatsActive,
	captureCacheAnomaly,
	captureCacheHit,
	captureCacheMiss,
	readCacheMissGap,
} from '../cache-events.js';

const next = vi.fn();

function makeRes() {
	return {
		locals: {},
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

// A cache HIT whose expiry sibling carries the enrichment (createdAt/ttlMs) that
// the hit telemetry reads.
function primeEnrichedHit() {
	getCacheValue.mockImplementation(async (_cache: unknown, key: string) => {
		if (key === 'cache-key') {
			return { data: [1] };
		}

		if (key === 'cache-key__expires_at') {
			return { exp: Date.now() + 1000, createdAt: Date.now() - 500, ttlMs: 1000 };
		}

		return undefined;
	});
}

beforeEach(() => {
	env['CACHE_ENABLED'] = true;
	delete env['CACHE_TAGS_HEADER'];
	shouldSkipCache.mockReturnValue(false);
	getCacheKey.mockResolvedValue('cache-key');
	vi.mocked(cacheStatsActive).mockReturnValue(false);
	vi.mocked(readCacheMissGap).mockResolvedValue(null);
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

	test('a skipped request sets the MISS header and calls next', async () => {
		shouldSkipCache.mockReturnValue(true);

		const res = makeRes();
		await checkCacheMiddleware(makeReq(), res, next);

		expect(res.setHeader).toHaveBeenCalledWith('x-cache-status', 'MISS');
		expect(next).toHaveBeenCalled();
	});

	test('a value read failure is logged and falls through as a MISS', async () => {
		getCacheValue.mockRejectedValueOnce(new Error('boom'));

		const res = makeRes();
		await checkCacheMiddleware(makeReq(), res, next);

		expect(warn).toHaveBeenCalled();
		expect(res.setHeader).toHaveBeenCalledWith('x-cache-status', 'MISS');
		expect(next).toHaveBeenCalled();
	});

	test('a read failure flags a redis_error anomaly when stats active', async () => {
		vi.mocked(cacheStatsActive).mockReturnValueOnce(true);
		getCacheValue.mockRejectedValueOnce(new Error('boom'));

		const res = makeRes();
		await checkCacheMiddleware(makeReq(), res, next);

		expect(captureCacheAnomaly).toHaveBeenCalledWith(
			expect.objectContaining({
				reason: 'redis_error',
				path: '/items/articles',
			}),
		);

		expect(res.setHeader).toHaveBeenCalledWith('x-cache-status', 'MISS');
		expect(next).toHaveBeenCalled();
	});

	test('an expiry-sibling read failure falls through as a MISS', async () => {
		getCacheValue.mockImplementation(async (_cache: unknown, key: string) => {
			if (key === 'cache-key') {
				return { data: [1] };
			}

			throw new Error('boom');
		});

		const res = makeRes();
		await checkCacheMiddleware(makeReq(), res, next);

		expect(warn).toHaveBeenCalled();
		expect(next).toHaveBeenCalled();
	});

	test('HIT captures hit telemetry when stats are active', async () => {
		vi.mocked(cacheStatsActive).mockReturnValue(true);
		primeEnrichedHit();

		const res = makeRes();
		await checkCacheMiddleware(makeReq(), res, next);

		expect(captureCacheHit).toHaveBeenCalledWith(
			expect.objectContaining({ cacheKey: 'cache-key', ttlMs: 1000 }),
		);

		expect(res.json).toHaveBeenCalledWith({ data: [1] });
	});

	test('HIT skips telemetry for a pre-enrichment entry', async () => {
		vi.mocked(cacheStatsActive).mockReturnValue(true);
		primeHit(undefined); // expires_at without createdAt

		const res = makeRes();
		await checkCacheMiddleware(makeReq(), res, next);

		expect(captureCacheHit).not.toHaveBeenCalled();
	});

	test('MISS captures telemetry with the tombstone gap', async () => {
		vi.mocked(cacheStatsActive).mockReturnValue(true);
		vi.mocked(readCacheMissGap).mockResolvedValue(4000);
		getCacheValue.mockResolvedValue(undefined);

		const res = makeRes();
		await checkCacheMiddleware(makeReq(), res, next);

		expect(readCacheMissGap).toHaveBeenCalledWith('cache-key', expect.any(Number));

		expect(captureCacheMiss).toHaveBeenCalledWith(
			expect.objectContaining({ cacheKey: 'cache-key', gapMs: 4000 }),
		);

		expect(next).toHaveBeenCalled();
	});

	test('MISS skips telemetry when stats are inactive', async () => {
		getCacheValue.mockResolvedValue(undefined);

		const res = makeRes();
		await checkCacheMiddleware(makeReq(), res, next);

		expect(captureCacheMiss).not.toHaveBeenCalled();
		expect(res.setHeader).toHaveBeenCalledWith('x-cache-status', 'MISS');
		expect(next).toHaveBeenCalled();
	});

	test('a HIT increments the response metric with result=hit', async () => {
		primeHit(undefined);

		await checkCacheMiddleware(makeReq(), makeRes(), next);

		expect(mocks.responseMetricInc).toHaveBeenCalledWith({ result: 'hit' });
	});

	test('a MISS increments the response metric with result=miss', async () => {
		getCacheValue.mockResolvedValue(undefined);

		await checkCacheMiddleware(makeReq(), makeRes(), next);

		expect(mocks.responseMetricInc).toHaveBeenCalledWith({ result: 'miss' });
	});
});
