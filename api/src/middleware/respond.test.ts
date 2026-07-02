import { oneLine } from '@directus/utils';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const env: Record<string, any> = {
	CACHE_ENABLED: true,
	CACHE_VALUE_MAX_SIZE: false,
	CACHE_TTL: '5m',
	CACHE_STATUS_HEADER: 'x-cache-status',
	CACHE_AUTO_PURGE: false,
	CACHE_NAMESPACE: 'test',
};

vi.mock('@directus/env', () => ({ useEnv: () => env }));

const mocks = vi.hoisted(() => {
	return {
		mockCache: { get: vi.fn(), set: vi.fn() },
		tagScopedCacheKeys: vi.fn(),
		warn: vi.fn(),
		permissionsCachable: vi.fn(),
		transform: vi.fn().mockReturnValue('EXPORTED'),
	};
});

const { mockCache, tagScopedCacheKeys, warn, permissionsCachable, transform } = mocks;

vi.mock('../cache.js', () => {
	return {
		getCache: () => ({ cache: mocks.mockCache }),
		setCacheValue: vi.fn(),
	};
});

vi.mock('../scoped-cache.js', () => ({ tagScopedCacheKeys: mocks.tagScopedCacheKeys }));

vi.mock('../database/index.js', () => ({ default: () => ({}) }));

vi.mock('../logger/index.js', () => ({ useLogger: () => ({ warn: mocks.warn }) }));

vi.mock('../utils/permissions-cachable.js', () => {
	return { permissionsCachable: mocks.permissionsCachable };
});

vi.mock('../utils/get-cache-key.js', () => {
	return { getCacheKey: vi.fn().mockResolvedValue('cache-key') };
});

vi.mock('../utils/get-cache-headers.js', () => {
	return { getCacheControlHeader: () => 'max-age=300' };
});

vi.mock('../utils/get-date-formatted.js', () => {
	return { getDateFormatted: () => '2020-01-01' };
});

vi.mock('../services/import-export.js', () => {
	return {
		ExportService: vi.fn().mockImplementation(() => ({ transform: mocks.transform })),
	};
});

import { setCacheValue } from '../cache.js';
import { respond } from './respond.js';

const next = vi.fn();

function makeRes(payload: any, locals: Record<string, any> = {}) {
	return {
		locals: { payload, ...locals },
		setHeader: vi.fn(),
		set: vi.fn(),
		status: vi.fn().mockReturnThis(),
		json: vi.fn().mockReturnThis(),
		send: vi.fn().mockReturnThis(),
		end: vi.fn().mockReturnThis(),
		attachment: vi.fn(),
	} as unknown as Response;
}

function makeReq(overrides: Partial<Request> = {}) {
	return {
		method: 'GET',
		originalUrl: '/items/articles',
		sanitizedQuery: {},
		schema: {},
		accountability: null,
		collection: 'articles',
		...overrides,
	} as unknown as Request;
}

beforeEach(() => {
	env['CACHE_ENABLED'] = true;
	env['CACHE_VALUE_MAX_SIZE'] = false;
	permissionsCachable.mockResolvedValue(true);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('respond middleware', () => {
	test(oneLine`
		cacheable GET MISS: sets cache value + expires_at and tags the scoped-cache keys
	`, async () => {
		const res = makeRes(
			{ data: [{ id: 1 }] },
			{ scopedCacheTags: [{ collection: 'articles' }] },
		);

		const req = makeReq();

		await respond(req, res, next);

		// value + __expires_at both written
		expect(vi.mocked(setCacheValue)).toHaveBeenCalledWith(
			mockCache,
			'cache-key',
			{ data: [{ id: 1 }] },
			expect.any(Number),
		);

		expect(vi.mocked(setCacheValue)).toHaveBeenCalledWith(
			mockCache,
			'cache-key__expires_at',
			{ exp: expect.any(Number) },
		);

		// #205 scoped-cache tagging fires with the request's tags
		expect(tagScopedCacheKeys).toHaveBeenCalledWith('cache-key', [
			{ collection: 'articles' },
		]);

		expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'max-age=300');
		expect(res.json).toHaveBeenCalledWith({ data: [{ id: 1 }] });
	});

	test('tags with an empty list when res.locals.scopedCacheTags is absent', async () => {
		const res = makeRes({ data: [] });
		const req = makeReq();

		await respond(req, res, next);

		expect(tagScopedCacheKeys).toHaveBeenCalledWith('cache-key', []);
	});

	test('caching failure is caught and logged, not thrown', async () => {
		vi.mocked(setCacheValue).mockRejectedValueOnce(new Error('boom'));
		const res = makeRes({ data: [] });
		const req = makeReq();

		await respond(req, res, next);

		expect(warn).toHaveBeenCalled();
		// tagging is skipped once the set throws, but the response still flushes
		expect(res.json).toHaveBeenCalled();
	});

	test('res.locals.cache === false skips caching (no-cache branch)', async () => {
		const res = makeRes({ data: [] }, { cache: false });
		const req = makeReq();

		await respond(req, res, next);

		expect(tagScopedCacheKeys).not.toHaveBeenCalled();
		expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
	});

	test('CACHE_ENABLED === false skips caching', async () => {
		env['CACHE_ENABLED'] = false;
		const res = makeRes({ data: [] });
		const req = makeReq();

		await respond(req, res, next);

		expect(vi.mocked(setCacheValue)).not.toHaveBeenCalled();
		expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
	});

	test(oneLine`
		CACHE_VALUE_MAX_SIZE measures the payload and skips caching when it exceeds the limit
	`, async () => {
		env['CACHE_VALUE_MAX_SIZE'] = '1b';
		const res = makeRes({ data: [{ big: 'x'.repeat(100) }] });
		const req = makeReq();

		await respond(req, res, next);

		// oversized payload → not cached, no-cache header instead
		expect(vi.mocked(setCacheValue)).not.toHaveBeenCalled();
		expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
	});

	test('CACHE_VALUE_MAX_SIZE with an empty payload measures size as 0', async () => {
		env['CACHE_VALUE_MAX_SIZE'] = '1kb';
		const res = makeRes(undefined);
		const req = makeReq();

		await respond(req, res, next);

		// falsy payload → size 0, under the limit, so caching still proceeds and 204 flushes
		expect(tagScopedCacheKeys).toHaveBeenCalledWith('cache-key', []);
		expect(res.status).toHaveBeenCalledWith(204);
	});

	test('a Buffer payload is streamed via res.end', async () => {
		env['CACHE_ENABLED'] = false;
		const buf = Buffer.from('hi');
		const res = makeRes(buf);
		const req = makeReq();

		await respond(req, res, next);

		expect(res.end).toHaveBeenCalledWith(buf);
	});

	test('a missing payload responds 204', async () => {
		env['CACHE_ENABLED'] = false;
		const res = makeRes(undefined);
		const req = makeReq();

		await respond(req, res, next);

		expect(res.status).toHaveBeenCalledWith(204);
		expect(res.end).toHaveBeenCalled();
	});

	test(oneLine`
		export json builds a collection-named attachment and transforms the payload
	`, async () => {
		const res = makeRes({ data: [{ id: 1 }] });
		const req = makeReq({ sanitizedQuery: { export: 'json' } as any });

		await respond(req, res, next);

		expect(res.attachment).toHaveBeenCalledWith('articles 2020-01-01.json');
		expect(transform).toHaveBeenCalledWith([{ id: 1 }], 'json');
		expect(res.send).toHaveBeenCalledWith('EXPORTED');
	});

	test('export xml with no collection falls back to the "Export" filename', async () => {
		const res = makeRes({ data: [{ id: 1 }] });

		const req = makeReq({
			collection: undefined,
			sanitizedQuery: { export: 'xml' } as any,
		});

		await respond(req, res, next);

		expect(res.attachment).toHaveBeenCalledWith('Export 2020-01-01.xml');
		expect(transform).toHaveBeenCalledWith([{ id: 1 }], 'xml');
	});
});
