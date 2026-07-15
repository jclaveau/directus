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
		scopedCachePurgeEnabled: vi.fn(() => false),
		serializeScopedCacheTags: vi.fn(() => 'SERIALIZED'),
		warn: vi.fn(),
		permissionsCachable: vi.fn(),
		transform: vi.fn().mockReturnValue('EXPORTED'),
		captureCacheDescriptor: vi.fn().mockResolvedValue(undefined),
		captureCacheAnomaly: vi.fn().mockResolvedValue(undefined),
		recordUncachedAnomaly: vi.fn().mockResolvedValue(undefined),
		writeCacheTombstone: vi.fn().mockResolvedValue(undefined),
	};
});

const { mockCache, tagScopedCacheKeys, warn, permissionsCachable, transform } = mocks;

vi.mock('../cache.js', () => {
	return {
		getCache: () => ({ cache: mocks.mockCache }),
		setCacheValue: vi.fn(),
	};
});

vi.mock('../scoped-cache.js', () => {
	return {
		tagScopedCacheKeys: mocks.tagScopedCacheKeys,
		scopedCachePurgeEnabled: mocks.scopedCachePurgeEnabled,
		serializeScopedCacheTags: mocks.serializeScopedCacheTags,
	};
});

// Stats active so the descriptor/tombstone capture on a fill is exercised.
vi.mock('../cache-events.js', () => {
	return {
		cacheStatsActive: () => true,
		captureCacheDescriptor: mocks.captureCacheDescriptor,
		captureCacheAnomaly: mocks.captureCacheAnomaly,
		writeCacheTombstone: mocks.writeCacheTombstone,
	};
});

vi.mock('../utils/record-uncached-anomaly.js', () => {
	return { recordUncachedAnomaly: mocks.recordUncachedAnomaly };
});

vi.mock('../database/index.js', () => ({ default: () => ({}) }));

vi.mock('../logger/index.js', () => ({ useLogger: () => ({ warn: mocks.warn }) }));

vi.mock('../utils/permissions-cachable.js', () => {
	return { permissionsCachable: mocks.permissionsCachable };
});

vi.mock('../utils/get-cache-key.js', () => {
	return { getCacheKey: vi.fn().mockResolvedValue('cache-key') };
});

vi.mock('../utils/get-graphql-query-and-variables.js', () => {
	return { getGraphqlQueryAndVariables: () => ({ query: '{ me }', variables: {} }) };
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
	delete env['CACHE_TAGS_HEADER'];
	delete env['CACHE_PURGED_TAGS_HEADER'];
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
			{
				exp: expect.any(Number),
				createdAt: expect.any(Number),
				ttlMs: expect.any(Number),
			},
		);

		// #205 scoped-cache tagging fires with the request's tags
		expect(tagScopedCacheKeys).toHaveBeenCalledWith('cache-key', [
			{ collection: 'articles' },
		], []);

		expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'max-age=300');
		expect(res.json).toHaveBeenCalledWith({ data: [{ id: 1 }] });
	});

	test('a fill with stats active captures the descriptor + tombstone', async () => {
		const res = makeRes(
			{ data: [{ id: 1 }] },
			{
				scopedCacheTags: [{ collection: 'articles' }],
				requestStart: Date.now() - 10,
			},
		);

		await respond(makeReq(), res, next);

		expect(mocks.captureCacheDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({
				cacheKey: 'cache-key',
				method: 'GET',
				path: '/items/articles',
				collection: 'articles',
				url: '/items/articles',
			}),
		);

		expect(mocks.writeCacheTombstone).toHaveBeenCalledWith(
			'cache-key',
			expect.any(Number),
		);
	});

	test('a graphql fill captures a blank url and the graphql query', async () => {
		const res = makeRes(
			{ data: { me: 1 } },
			{ scopedCacheTags: [{ collection: 'articles' }] },
		);

		await respond(makeReq({ method: 'POST', originalUrl: '/graphql' }), res, next);

		expect(mocks.captureCacheDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({
				url: '',
				query: JSON.stringify({ query: '{ me }', variables: {} }),
			}),
		);
	});

	test('falls back to the bare collection tag when tags are absent', async () => {
		const res = makeRes({ data: [] });
		const req = makeReq();

		await respond(req, res, next);

		// A controller that set no tags → the bare `{ collection }` tag, so a mutation
		// on that collection still purges the cached response (the settings fix).
		expect(tagScopedCacheKeys).toHaveBeenCalledWith(
			'cache-key',
			[{ collection: 'articles' }],
			[],
		);
	});

	test('skips caching a collection-less response in scoped mode', async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValueOnce(true);
		const res = makeRes({ data: {} });
		const req = makeReq({ collection: undefined, originalUrl: '/server/info' });

		await respond(req, res, next);

		// No tags AND no collection under scoped purge → nothing could target it, so
		// it is not cached (rather than orphan a stale entry no purge can drop).
		expect(vi.mocked(setCacheValue)).not.toHaveBeenCalled();
		expect(tagScopedCacheKeys).not.toHaveBeenCalled();
	});

	test('caches a collection-less response in full-purge mode', async () => {
		// scopedCachePurgeEnabled defaults to false → full mode. The same tagless,
		// collection-less response IS cached (a mutation clears the whole cache).
		const res = makeRes({ data: {} });
		const req = makeReq({ collection: undefined, originalUrl: '/server/info' });

		await respond(req, res, next);

		expect(vi.mocked(setCacheValue)).toHaveBeenCalled();
		expect(tagScopedCacheKeys).toHaveBeenCalledWith('cache-key', [], []);
	});

	test('caching failure is caught and logged, not thrown', async () => {
		vi.mocked(setCacheValue).mockRejectedValueOnce(new Error('boom'));
		const res = makeRes({ data: [] });
		const req = makeReq();

		await respond(req, res, next);

		expect(warn).toHaveBeenCalled();
		// tagging is skipped once the set throws, but the response still flushes
		expect(res.json).toHaveBeenCalled();

		// the failed write also surfaces as a redis_error anomaly on the dashboard
		expect(mocks.recordUncachedAnomaly).toHaveBeenCalledWith(
			expect.any(Object),
			'redis_error',
			expect.any(String),
		);
	});

	test('an oversized payload is not cached and flags value_too_large', async () => {
		env['CACHE_VALUE_MAX_SIZE'] = '1b';
		const res = makeRes({ data: [{ id: 1, blob: 'x'.repeat(100) }] });

		await respond(makeReq(), res, next);

		expect(vi.mocked(setCacheValue)).not.toHaveBeenCalled();

		expect(mocks.recordUncachedAnomaly).toHaveBeenCalledWith(
			expect.any(Object),
			'value_too_large',
			expect.any(String),
		);
	});

	test('a scoped-mode collection-less response flags scoped_orphan', async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValueOnce(true);
		const res = makeRes({ data: {} });
		const req = makeReq({ collection: undefined, originalUrl: '/server/info' });

		await respond(req, res, next);

		expect(vi.mocked(setCacheValue)).not.toHaveBeenCalled();

		expect(mocks.recordUncachedAnomaly).toHaveBeenCalledWith(
			expect.any(Object),
			'scoped_orphan',
		);
	});

	test('an unpinnable null-tags fill flags coarse_scope', async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValueOnce(true);

		// A deriver that couldn't resolve pins sets scopedCacheTags to null; the entry
		// still caches under the coarse collection tag, keyed by the same cache key.
		const res = makeRes({ data: [{ id: 1 }] }, { scopedCacheTags: null });

		await respond(makeReq(), res, next);

		expect(vi.mocked(setCacheValue)).toHaveBeenCalled();

		expect(mocks.captureCacheAnomaly).toHaveBeenCalledWith({
			cacheKey: 'cache-key',
			reason: 'coarse_scope',
		});
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
		expect(tagScopedCacheKeys).toHaveBeenCalledWith(
			'cache-key',
			[{ collection: 'articles' }],
			[],
		);

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

	test(oneLine`
		CACHE_TAGS_HEADER MISS: emits the pins header, tags the __tags sibling
	`, async () => {
		env['CACHE_TAGS_HEADER'] = 'X-Scoped-Cache-Tags';

		const res = makeRes(
			{ data: [{ id: 1 }] },
			{
				scopedCacheTags: [
					{ collection: 'articles', field: 'owner', value: 'U1' },
				],
			},
		);

		await respond(makeReq(), res, next);

		expect(res.setHeader).toHaveBeenCalledWith(
			'X-Scoped-Cache-Tags',
			'SERIALIZED',
		);

		expect(vi.mocked(setCacheValue)).toHaveBeenCalledWith(
			mockCache,
			'cache-key__tags',
			{ tags: 'SERIALIZED' },
			expect.any(Number),
		);

		expect(tagScopedCacheKeys).toHaveBeenCalledWith(
			'cache-key',
			[{ collection: 'articles', field: 'owner', value: 'U1' }],
			['cache-key__tags'],
		);
	});

	test('CACHE_PURGED_TAGS_HEADER emits purged tags on a mutation', async () => {
		env['CACHE_PURGED_TAGS_HEADER'] = 'X-Scoped-Cache-Purged-Tags';

		const res = makeRes(
			{ data: { id: 1 } },
			{
				scopedCachePurged: [
					{ collection: 'articles', field: 'owner', value: 'U2' },
				],
			},
		);

		await respond(makeReq({ method: 'PATCH' }), res, next);

		expect(res.setHeader).toHaveBeenCalledWith(
			'X-Scoped-Cache-Purged-Tags',
			'SERIALIZED',
		);
	});

	test('tag headers stay absent when their envs are unset', async () => {
		const res = makeRes(
			{ data: [] },
			{
				scopedCacheTags: [{ collection: 'articles' }],
				scopedCachePurged: [{ collection: 'articles' }],
			},
		);

		await respond(makeReq(), res, next);

		const names = vi.mocked(res.setHeader).mock.calls.map((call) => call[0]);
		expect(names).not.toContain('X-Scoped-Cache-Tags');
		expect(names).not.toContain('X-Scoped-Cache-Purged-Tags');
	});
});
