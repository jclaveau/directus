import { oneLine } from '@directus/utils';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Hoisted, because `scoped-cache.js` is now imported for real (see its mock
// below) and reads `useEnv()` at module scope — which runs while the mock
// factories do, before a plain `const` here would be initialised.
const env: Record<string, any> = vi.hoisted(() => {
	return {
		CACHE_ENABLED: true,
		CACHE_VALUE_MAX_SIZE: false,
		CACHE_TTL: '5m',
		CACHE_STATUS_HEADER: 'x-cache-status',
		CACHE_AUTO_PURGE: false,
		CACHE_NAMESPACE: 'test',
	};
});

vi.mock('@directus/env', () => ({ useEnv: () => env }));

const mocks = vi.hoisted(() => {
	return {
		mockCache: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
		indexScopedCacheEntry: vi.fn(),
		scopedCachePurgeEnabled: vi.fn(() => false),
		warn: vi.fn(),
		permissionsCachable: vi.fn(),
		queryCachable: vi.fn(() => true),
		transform: vi.fn().mockReturnValue('EXPORTED'),
		queueCacheDescriptor: vi.fn().mockResolvedValue(undefined),
		reportCacheAnomaly: vi.fn().mockResolvedValue(undefined),
		writeCacheTombstone: vi.fn().mockResolvedValue(undefined),
		scopedCacheSweptDuringFill: vi.fn().mockResolvedValue(undefined),
		evictCacheEntry: vi.fn(async (cache: any, redisKey: string) => {
			await cache.delete(redisKey);
			await cache.delete(`${redisKey}__expires_at`);
			await cache.delete(`${redisKey}__tags`);

			// The real one reads the key back, because a store reports an error by
			// answering `undefined` rather than throwing.
			return true;
		}),
		recordPendingScopedCachePurge: vi.fn().mockResolvedValue(undefined),
		queueMissLatency: vi.fn(),
		stringByteSize: vi.fn((s: string) => Buffer.byteLength(s, 'utf8')),
	};
});

const {
	mockCache,
	indexScopedCacheEntry,
	warn,
	permissionsCachable,
	transform,
} = mocks;

vi.mock('../cache.js', () => {
	return {
		getCache: () => ({ cache: mocks.mockCache }),
		setCacheValue: vi.fn(),
	};
});

vi.mock('../scoped-cache.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../scoped-cache.js')>();

	return {
		indexScopedCacheEntry: mocks.indexScopedCacheEntry,
		scopedCachePurgeEnabled: mocks.scopedCachePurgeEnabled,
		scopedCacheSweptDuringFill: mocks.scopedCacheSweptDuringFill,
		// Real, so the unguarded cases below assert the predicate rather than a
		// stand-in agreeing with them: it is pure, and reaches no Redis.
		scopedCacheCollectionsWithoutGuard: actual.scopedCacheCollectionsWithoutGuard,
		mergedScopedCacheEpochs: actual.mergedScopedCacheEpochs,
		// The real one, not a stand-in. The descriptor assertion reads the pin
		// SPELLING, and a copy here drifts off `canonicalizeScopedCachePinValue` — it
		// would render a boolean slice `=1` where production writes `=true`, so
		// the test would agree with itself while the purge join matched nothing.
		scopedCachePinKeys: actual.scopedCachePinKeys,
		// Same reason, for the form a recorded purge is retried from.
		renderScopedCacheFingerprint: actual.renderScopedCacheFingerprint,
		// And for the coarse flag the descriptor cases below assert: which shapes
		// count as bare is the predicate's answer, not a second one written here.
		scopedCacheFingerprintIsBare: actual.scopedCacheFingerprintIsBare,
	};
});

// Stats active so the descriptor/tombstone snapshot on a fill is exercised.
vi.mock('../cache-events.js', () => {
	return {
		cacheStatsActive: () => true,
		evictCacheEntry: mocks.evictCacheEntry,
		queueCacheDescriptor: mocks.queueCacheDescriptor,
		writeCacheTombstone: mocks.writeCacheTombstone,
		queueMissLatency: mocks.queueMissLatency,
	};
});

vi.mock('../scoped-cache-pending-purges.js', () => {
	return { recordPendingScopedCachePurge: mocks.recordPendingScopedCachePurge };
});

vi.mock('../utils/get-string-byte-size.js', () => {
	return { stringByteSize: mocks.stringByteSize };
});

vi.mock('../utils/cache-audit-replay.js', () => {
	return {
		CACHE_AUDIT_PINS_HEADER: 'x-cache-audit-pins',
		isCacheAuditReplay: vi.fn(() => false),
	};
});

vi.mock('../utils/report-cache-anomaly.js', () => {
	return { reportCacheAnomaly: mocks.reportCacheAnomaly };
});

vi.mock('../database/index.js', () => ({ default: () => ({}) }));

vi.mock('../logger/index.js', () => ({ useLogger: () => ({ warn: mocks.warn }) }));

vi.mock('../utils/permissions-cachable.js', () => {
	return { permissionsCachable: mocks.permissionsCachable };
});

vi.mock('../utils/query-cachable.js', () => {
	return { queryCachable: mocks.queryCachable };
});

vi.mock('../utils/get-cache-key.js', () => {
	return {
		getCacheKey: vi.fn().mockResolvedValue({
			redisKey: 'cache-key',
			cacheKey: 'cache-hash',
		}),
	};
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
import { isCacheAuditReplay } from '../utils/cache-audit-replay.js';
import { getCacheKey } from '../utils/get-cache-key.js';
import { withMeta } from '../utils/read-meta.js';
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

function makeReq(
	// `collection` is defaulted below, and the only way to spread a default away is
	// to pass the key with `undefined` — which `Partial` forbids under
	// `exactOptionalPropertyTypes`. Only this field is ever cleared that way.
	overrides: Omit<Partial<Request>, 'collection'> & {
		collection?: string | undefined;
	} = {},
) {
	return {
		method: 'GET',
		originalUrl: '/items/articles',
		sanitizedQuery: {},
		schema: { collections: {}, relations: [] },
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
	delete env['CACHE_TAGS_HEADER_MAX_SIZE'];
	permissionsCachable.mockResolvedValue(true);
	mocks.queryCachable.mockReturnValue(true);
	mocks.scopedCachePurgeEnabled.mockReturnValue(false);
});

afterEach(() => {
	vi.clearAllMocks();
	vi.mocked(isCacheAuditReplay).mockReturnValue(false);
});

describe('respond middleware', () => {
	test(oneLine`
		cacheable GET MISS: sets cache value + expires_at and tags the scoped-cache keys
	`, async () => {
		const res = makeRes(
			{ data: [{ id: 1 }] },
			{
				scopedCacheFingerprints: [{
					collection: 'articles',
				}],
			},
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

		// Written straight through the store, not through `setCacheValue`: three
		// numbers do not repay a compression pass on every fill and a second on
		// every hit.
		expect(mockCache.set).toHaveBeenCalledWith(
			'cache-key__expires_at',
			{
				exp: expect.any(Number),
				createdAt: expect.any(Number),
				ttlMs: expect.any(Number),
			},
			// The sibling carries an explicit ttl so it tracks the live override,
			// not the response cache's construction-time Keyv default.
			expect.any(Number),
		);

		// #205 scoped-cache tagging fires with the request's fingerprints, the legacy
		// flat pins the old index is still written under, and the schema the index
		// path of each collection is read off — this one declares no scope field, so
		// every fingerprint goes in the bare set.
		expect(indexScopedCacheEntry).toHaveBeenCalledWith(
			'cache-key',
			[{ collection: 'articles' }],
			[],
			{ collections: {}, relations: [] },
		);

		expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'max-age=300');
		expect(res.json).toHaveBeenCalledWith({ data: [{ id: 1 }] });
	});

	test(oneLine`
		takes the cache key the middleware already built for the lookup that missed,
		rather than rebuilding it — each build runs a policy ip-access lookup
	`, async () => {
		await respond(makeReq(), makeRes(
			{ data: [{ id: 1 }] },
			{
				scopedCacheFingerprints: [{
					collection: 'articles',
				}],
				httpRequestCacheKey: {
					redisKey: 'middleware-key',
					cacheKey: 'middleware-hash',
				},
			},
		), next);

		expect(vi.mocked(getCacheKey)).not.toHaveBeenCalled();

		expect(vi.mocked(setCacheValue)).toHaveBeenCalledWith(
			mockCache,
			'middleware-key',
			{ data: [{ id: 1 }] },
			expect.any(Number),
		);
	});

	test('a fill with stats active captures the descriptor + tombstone', async () => {
		const res = makeRes(
			{ data: [{ id: 1 }] },
			{
				scopedCacheFingerprints: [{
					collection: 'articles',
				}],
				requestStart: Date.now() - 10,
			},
		);

		await respond(makeReq(), res, next);

		expect(mocks.queueCacheDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({
				cacheKey: 'cache-hash',
				redisKey: 'cache-key',
				method: 'GET',
				path: '/items/articles',
				collection: 'articles',
				// The query string as sent, so the URL rebuilds from path + query.
				query: '',
				// cap off: bytes still comes from one serialization
				bytes: Buffer.byteLength(JSON.stringify({ data: [{ id: 1 }] }), 'utf8'),
			}),
		);

		expect(mocks.writeCacheTombstone).toHaveBeenCalledWith(
			'cache-key',
			expect.any(Number),
		);

		expect(mocks.queueMissLatency).toHaveBeenCalledWith(
			expect.any(Number),
			'fill',
			'cache-hash',
		);

		await respond(
			makeReq({ originalUrl: '/items/articles?limit=5&fields=id' }),
			res,
			next,
		);

		// Path and query split at the '?' and nothing else: joined back they are
		// the URL as sent, which is why neither is normalized on the way in.
		expect(mocks.queueCacheDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({
				path: '/items/articles',
				query: 'limit=5&fields=id',
			}),
		);
	});

	test(oneLine`
		the fill cost counts the write of the entry, not only the read
	`, async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1000);

		// A SET that takes 300 ms: the miss is not filled until it lands, so the
		// number the descriptor reports has to hold it.
		vi.mocked(setCacheValue).mockImplementationOnce(async () => {
			vi.setSystemTime(1300);
		});

		const res = makeRes(
			{ data: [{ id: 1 }] },
			{
				scopedCacheFingerprints: [{
					collection: 'articles',
				}],
				requestStart: 900,
			},
		);

		try {
			await respond(makeReq(), res, next);
		}
		finally {
			vi.useRealTimers();
		}

		expect(mocks.queueMissLatency).toHaveBeenCalledWith(400, 'fill', 'cache-hash');

		expect(mocks.queueCacheDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({ fillMs: 400 }),
		);
	});

	test(oneLine`
		reuses the size-gate serialization for the descriptor bytes (one stringify)
	`, async () => {
		env['CACHE_VALUE_MAX_SIZE'] = '1mb';
		mocks.stringByteSize.mockClear();

		const payload = { data: [{ id: 1, blob: 'x'.repeat(200) }] };

		await respond(makeReq(), makeRes(payload, {
			scopedCacheFingerprints: [{
				collection: 'articles',
			}],
		}), next);

		// The size cap + the descriptor bytes share ONE payload serialization, not two.
		expect(mocks.stringByteSize).toHaveBeenCalledTimes(1);

		expect(mocks.queueCacheDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({
				bytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
			}),
		);
	});

	test('a graphql fill captures a blank url and the graphql query', async () => {
		const res = makeRes(
			{ data: { me: 1 } },
			{
				scopedCacheFingerprints: [{
					collection: 'articles',
				}],
			},
		);

		await respond(makeReq({ method: 'POST', originalUrl: '/graphql' }), res, next);

		// A GraphQL read has no query string to keep; its document and variables
		// travel in the POST body and go in the same column instead.
		expect(mocks.queueCacheDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({
				query: JSON.stringify({ query: '{ me }', variables: {} }),
			}),
		);
	});

	test('falls back to the bare collection tag when tags are absent', async () => {
		const res = makeRes({ data: [] });
		const req = makeReq();

		await respond(req, res, next);

		// A controller that set no pins → the bare `{ collection }` pin, so a mutation
		// on that collection still purges the cached response (the settings fix).
		expect(indexScopedCacheEntry).toHaveBeenCalledWith(
			'cache-key',
			[{ collection: 'articles' }],
			[],
			{ collections: {}, relations: [] },
		);
	});

	test(oneLine`
		reads the fingerprints off the payload when the controller forwarded none — a
		system route hands over the service's result as is, and the relations it
		nested would otherwise be invisible to every purge (#505)
	`, async () => {
		await respond(
			makeReq({ originalUrl: '/users/me', collection: 'directus_users' }),
			makeRes({
				data: withMeta(
					{ id: 'u1', student_profile: [] },
					{
						scopedCacheFingerprints: [
							{
								collection: 'directus_users',
								pinnedScope: { id: ['u1'] },
							},
							{ collection: 'student' },
						],
					},
				),
			}),
			next,
		);

		expect(indexScopedCacheEntry).toHaveBeenCalledWith(
			'cache-key',
			[
				{
					collection: 'directus_users',
					pinnedScope: { id: ['u1'] },
				},
				{ collection: 'student' },
			],
			[],
			{ collections: {}, relations: [] },
		);
	});

	test(oneLine`
		guards the payload's tags by the counters the read took before its query,
		folded into the ones useCollection took for the route's own collection
	`, async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValue(true);

		await respond(
			makeReq({ originalUrl: '/users/me', collection: 'directus_users' }),
			makeRes(
				{
					data: withMeta({ id: 'u1' }, {
						scopedCacheFingerprints: [
							{ collection: 'directus_users' },
							{ collection: 'student' },
						],
						scopedCacheEpochs: {
							directus_users: '4', student: '5', '*': '1',
						},
					}),
				},
				{ scopedCacheEpochsBeforeQuery: { directus_users: '3', '*': '1' } },
			),
			next,
		);

		expect(mocks.scopedCacheSweptDuringFill).toHaveBeenCalledWith(
			{ directus_users: '3', student: '5', '*': '1' },
		);

		expect(mocks.reportCacheAnomaly).not.toHaveBeenCalled();
	});

	test(oneLine`
		refuses to cache a payload whose meta names unautopurgeable fingerprints, the
		same as when a controller forwards them
	`, async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValue(true);

		await respond(
			makeReq({ originalUrl: '/users/me', collection: 'directus_users' }),
			makeRes({
				data: withMeta({ id: 'u1' }, {
					scopedCacheFingerprints: [
						{ collection: 'directus_users' },
					],
					scopedCacheUnautopurgeableFingerprints: [{
						collection: 'student',
						pinnedScope: { level: ['3'] },
					}],
				}),
			}),
			next,
		);

		expect(vi.mocked(setCacheValue)).not.toHaveBeenCalled();

		expect(mocks.reportCacheAnomaly).toHaveBeenCalledWith(
			expect.anything(),
			'unautopurgeable_scope',
			'student:level',
		);
	});

	test(oneLine`
		a pinned read reporting total_count keeps the bare collection tag beside its
		pins — the count drops the filter, so a row the pins never bounded changes it
	`, async () => {
		const res = makeRes(
			{ meta: { total_count: 2 }, data: [{ id: 1 }] },
			{
				scopedCacheFingerprints: [
					{ collection: 'articles', pinnedScope: { id: ['1'] } },
				],
			},
		);

		const req = makeReq({ sanitizedQuery: { meta: ['total_count'] } });

		await respond(req, res, next);

		expect(indexScopedCacheEntry).toHaveBeenCalledWith(
			'cache-key',
			// The count drops the filter, so the fingerprint drops the pin with it:
			// bound to nothing, any write to the collection moves the number.
			[{ collection: 'articles' }],
			[],
			{ collections: {}, relations: [] },
		);
	});

	test(oneLine`
		filter_count alone leaves the pins alone — it counts inside the same filter, so
		no row outside the pinned slices can move it
	`, async () => {
		const res = makeRes(
			{ meta: { filter_count: 1 }, data: [{ id: 1 }] },
			{
				scopedCacheFingerprints: [
					{ collection: 'articles', pinnedScope: { id: ['1'] } },
				],
			},
		);

		const req = makeReq({ sanitizedQuery: { meta: ['filter_count'] } });

		await respond(req, res, next);

		expect(indexScopedCacheEntry).toHaveBeenCalledWith(
			'cache-key',
			[{ collection: 'articles', pinnedScope: { id: ['1'] } }],
			[],
			{ collections: {}, relations: [] },
		);
	});

	test(oneLine`
		meta=* keeps the bare tag too — it expands to every counter, so the read carries
		total_count without ever naming it
	`, async () => {
		const res = makeRes(
			{ meta: { total_count: 2, filter_count: 1 }, data: [{ id: 1 }] },
			{
				scopedCacheFingerprints: [
					{ collection: 'articles', pinnedScope: { id: ['1'] } },
				],
			},
		);

		// The shape `sanitizeMeta` produces for `*`, which is where the expansion
		// happens — this guard only ever sees the expanded list.
		const req = makeReq({
			sanitizedQuery: { meta: ['total_count', 'filter_count'] },
		});

		await respond(req, res, next);

		expect(indexScopedCacheEntry).toHaveBeenCalledWith(
			'cache-key',
			// The count drops the filter, so the fingerprint drops the pin with it:
			// bound to nothing, any write to the collection moves the number.
			[{ collection: 'articles' }],
			[],
			// The schema the index path is read off: this one declares no scope
			// field on `articles`, so it is filed in the bare set.
			{ collections: {}, relations: [] },
		);
	});

	test(oneLine`
		total_count on an unpinned read adds no duplicate — the bare collection tag it
		already fell back to is the same tag the count needs
	`, async () => {
		const res = makeRes({ meta: { total_count: 2 }, data: [{ id: 1 }] });
		const req = makeReq({ sanitizedQuery: { meta: ['total_count'] } });

		await respond(req, res, next);

		expect(indexScopedCacheEntry).toHaveBeenCalledWith(
			'cache-key',
			[{ collection: 'articles' }],
			[],
			{ collections: {}, relations: [] },
		);
	});

	test(oneLine`
		a cache-audit replay answers the tags a fill would pin, and stores nothing
	`, async () => {
		vi.mocked(isCacheAuditReplay).mockReturnValue(true);

		const res = makeRes(
			{ data: [{ id: 1 }] },
			{
				cache: false,
				scopedCacheFingerprints: [
					{
						collection: 'articles',
						pinnedScope: { owner: ['U1'] },
					},
					{ collection: 'authors' },
				],
			},
		);

		await respond(makeReq(), res, next);

		expect(res.setHeader).toHaveBeenCalledWith(
			'x-cache-audit-pins',
			'["articles:owner=U1","authors"]',
		);

		expect(res.json).toHaveBeenCalledWith({ data: [{ id: 1 }] });
		expect(vi.mocked(setCacheValue)).not.toHaveBeenCalled();
		expect(indexScopedCacheEntry).not.toHaveBeenCalled();
	});

	test(oneLine`
		a replay of a pinless collection-less read answers an empty pins header
	`, async () => {
		vi.mocked(isCacheAuditReplay).mockReturnValue(true);
		const res = makeRes({ data: {} }, { cache: false });
		const req = makeReq({ collection: undefined, originalUrl: '/server/info' });

		await respond(req, res, next);

		expect(res.setHeader).toHaveBeenCalledWith('x-cache-audit-pins', '[]');
	});

	test('skips caching a collection-less response in scoped mode', async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValueOnce(true);
		const res = makeRes({ data: {} });
		const req = makeReq({ collection: undefined, originalUrl: '/server/info' });

		await respond(req, res, next);

		// No pins AND no collection under scoped purge → nothing could target it, so
		// it is not cached (rather than orphan a stale entry no purge can drop).
		expect(vi.mocked(setCacheValue)).not.toHaveBeenCalled();
		expect(indexScopedCacheEntry).not.toHaveBeenCalled();
	});

	test('caches a collection-less response in full-purge mode', async () => {
		// scopedCachePurgeEnabled defaults to false → full mode. The same tagless,
		// collection-less response IS cached (a mutation clears the whole cache).
		const res = makeRes({ data: {} });
		const req = makeReq({ collection: undefined, originalUrl: '/server/info' });

		await respond(req, res, next);

		expect(vi.mocked(setCacheValue)).toHaveBeenCalled();

		expect(indexScopedCacheEntry).toHaveBeenCalledWith(
			'cache-key',
			[],
			[],
			{ collections: {}, relations: [] },
		);
	});

	test(oneLine`
		names the collection whose purge raced the fill, so a read serving rows a write
		already replaced is attributable rather than silent
	`, async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValue(true);
		mocks.scopedCacheSweptDuringFill.mockResolvedValue('articles');

		const res = makeRes({ data: [] }, {
			scopedCacheFingerprints: [{
				collection: 'articles',
			}],
			scopedCacheEpochs: { articles: '7' },
		});

		await respond(makeReq(), res, next);

		expect(mocks.reportCacheAnomaly).toHaveBeenCalledWith(
			expect.anything(),
			'inflight_purge',
			'articles',
		);

		expect(res.json).toHaveBeenCalled();
	});

	test(oneLine`
		records the entry a failed eviction left cached, so the drain finishes what
		the in-flight purge could not
	`, async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValue(true);
		mocks.scopedCacheSweptDuringFill.mockResolvedValue('articles');

		// What a store that swallowed the delete answers. Nothing throws, so
		// without reading the eviction back the entry stays and serves rows the
		// purge already superseded, for its whole TTL.
		// `Once`, not a standing override: `clearAllMocks` resets the calls but keeps
		// the implementation, so a standing one would answer for every later test.
		mocks.evictCacheEntry.mockResolvedValueOnce(false);

		const res = makeRes({ data: [] }, {
			scopedCacheFingerprints: [
				{ collection: 'articles', pinnedScope: { author: ['7'] } },
			],
			scopedCacheEpochs: { articles: '7' },
		});

		await respond(makeReq(), res, next);

		expect(mocks.recordPendingScopedCachePurge).toHaveBeenCalledWith(
			{
				mode: 'slices',
				collection: 'articles',
				scopedCacheFingerprints: ['articles:&author=,7,&'],
			},
			expect.any(Error),
		);

		// The rows are gone once drained, so the log line is the only trace of
		// why a slice got purged a minute later (#507).
		expect(mocks.warn).toHaveBeenCalledWith(
			expect.any(Error),
			expect.stringContaining('eviction failed and was recorded for retry'),
		);
	});

	test('records nothing when the eviction took', async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValue(true);
		mocks.scopedCacheSweptDuringFill.mockResolvedValue('articles');

		const res = makeRes({ data: [] }, {
			scopedCacheFingerprints: [{
				collection: 'articles',
			}],
			scopedCacheEpochs: { articles: '7' },
		});

		await respond(makeReq(), res, next);

		expect(mocks.recordPendingScopedCachePurge).not.toHaveBeenCalled();
	});

	test(oneLine`
		a purge that swept while the fill was writing takes the entry back out — its
		sweep read the tag index before this key was filed into it
	`, async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValue(true);

		// Moved by the time the writes landed: the guard's reading is taken after
		// them, and it is the one that decides.
		mocks.scopedCacheSweptDuringFill.mockResolvedValue('articles');

		const res = makeRes({ data: [] }, {
			scopedCacheFingerprints: [{
				collection: 'articles',
			}],
			scopedCacheEpochs: { articles: '7' },
		});

		await respond(makeReq(), res, next);

		expect(vi.mocked(setCacheValue)).toHaveBeenCalled();
		expect(mockCache.delete).toHaveBeenCalledWith('cache-key');
		expect(mockCache.delete).toHaveBeenCalledWith('cache-key__expires_at');
	});

	test(oneLine`
		the control: an unmoved epoch is the ordinary fill, so the guard cannot be
		passing by refusing to cache everything
	`, async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValue(true);
		mocks.scopedCacheSweptDuringFill.mockResolvedValue(undefined);

		const res = makeRes({ data: [] }, {
			scopedCacheFingerprints: [{
				collection: 'articles',
			}],
			scopedCacheEpochs: { articles: '7' },
		});

		await respond(makeReq(), res, next);

		expect(vi.mocked(setCacheValue)).toHaveBeenCalled();
	});

	test(oneLine`
		refuses to cache a response scoped to a collection the before-query reading
		never covered — a hook's scopeTo runs after it, so no counter can show a
		purge of that collection landed mid-read
	`, async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValue(true);

		await respond(makeReq(), makeRes({ data: [] }, {
			scopedCacheFingerprints: [
				{ collection: 'articles' },
				{ collection: 'authors' },
			],
			scopedCacheEpochs: { articles: '7', '*': '1' },
		}), next);

		expect(vi.mocked(setCacheValue)).not.toHaveBeenCalled();

		expect(mocks.reportCacheAnomaly).toHaveBeenCalledWith(
			expect.anything(),
			'unguarded_scope',
			'authors',
		);
	});

	test(oneLine`
		caches the same response once the foreign collection's counter was handed over,
		so declaring a cross-collection dependency stays a cacheable thing to do
	`, async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValue(true);

		await respond(makeReq(), makeRes({ data: [] }, {
			scopedCacheFingerprints: [
				{ collection: 'articles' },
				{ collection: 'authors' },
			],
			scopedCacheEpochs: { articles: '7', authors: '4', '*': '1' },
		}), next);

		expect(vi.mocked(setCacheValue)).toHaveBeenCalled();
		expect(mocks.reportCacheAnomaly).not.toHaveBeenCalled();
	});

	test(oneLine`
		guards a system route's fallback tag by the reading useCollection took, so a
		read handing over no reading of its own is still compared after the fill
	`, async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValue(true);
		mocks.scopedCacheSweptDuringFill.mockResolvedValueOnce('directus_users');

		await respond(makeReq({ collection: 'directus_users' }), makeRes({ data: [] }, {
			scopedCacheEpochsBeforeQuery: { directus_users: '3', '*': '1' },
		}), next);

		expect(mocks.scopedCacheSweptDuringFill).toHaveBeenCalledWith(
			{ directus_users: '3', '*': '1' },
		);

		expect(mocks.evictCacheEntry).toHaveBeenCalled();
	});

	test(oneLine`
		folds the request's before-query reading into the read's own, earlier
		reading first, so a purge between the two is still visible at fill time
	`, async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValue(true);

		await respond(makeReq(), makeRes({ data: [] }, {
			scopedCacheFingerprints: [
				{ collection: 'articles' },
				{ collection: 'authors' },
			],
			scopedCacheEpochsBeforeQuery: { articles: '7', '*': '1' },
			scopedCacheEpochs: { articles: '8', authors: '4', '*': '1' },
		}), next);

		expect(mocks.scopedCacheSweptDuringFill).toHaveBeenCalledWith(
			{ articles: '7', authors: '4', '*': '1' },
		);

		expect(mocks.reportCacheAnomaly).not.toHaveBeenCalled();
	});

	test(oneLine`
		leaves a response alone when no reading was taken at all — with no wholesale
		entry there is no guard to be outside of, and refusing would take the whole
		cache down wherever the counters are off
	`, async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValue(true);

		await respond(makeReq(), makeRes({ data: [] }, {
			scopedCacheFingerprints: [{
				collection: 'authors',
			}],
			scopedCacheEpochs: {},
		}), next);

		expect(vi.mocked(setCacheValue)).toHaveBeenCalled();
	});

	test(oneLine`
		a refused tag index leaves NO value cached: an untagged entry is unreachable to
		every purge and would serve stale for its whole TTL
	`, async () => {
		vi.mocked(indexScopedCacheEntry).mockRejectedValueOnce(new Error('OOM'));
		const res = makeRes({ data: [] });
		const req = makeReq();

		await respond(req, res, next);

		expect(vi.mocked(setCacheValue)).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalled();
		expect(res.json).toHaveBeenCalled();

		expect(mocks.reportCacheAnomaly).toHaveBeenCalledWith(
			expect.any(Object),
			'redis_error',
			'OOM',
		);
	});

	test('caching failure is caught and logged, not thrown', async () => {
		vi.mocked(setCacheValue).mockRejectedValueOnce(new Error('boom'));
		const res = makeRes({ data: [] });
		const req = makeReq();

		await respond(req, res, next);

		expect(warn).toHaveBeenCalled();
		// The pin index is written first, so a failed value write leaves a pin naming
		// a key that never landed — one wasted `del` on the next purge, nothing stale.
		expect(res.json).toHaveBeenCalled();

		// the failed write also surfaces as a redis_error anomaly carrying the message
		expect(mocks.reportCacheAnomaly).toHaveBeenCalledWith(
			expect.any(Object),
			'redis_error',
			'boom',
		);
	});

	test('an oversized payload is not cached and flags value_too_large', async () => {
		env['CACHE_VALUE_MAX_SIZE'] = '1b';
		const res = makeRes({ data: [{ id: 1, blob: 'x'.repeat(100) }] });

		await respond(makeReq(), res, next);

		expect(vi.mocked(setCacheValue)).not.toHaveBeenCalled();

		expect(mocks.reportCacheAnomaly).toHaveBeenCalledWith(
			expect.any(Object),
			'value_too_large',
			expect.stringMatching(/^\d+B$/),
		);

		expect(mocks.queueMissLatency).toHaveBeenCalledWith(
			expect.any(Number),
			'anomaly',
		);
	});

	test('$NOW query filter is not cached', async () => {
		mocks.queryCachable.mockReturnValue(false);
		const res = makeRes({ data: [{ id: 1 }] });

		const req = makeReq({
			sanitizedQuery: { filter: { created_on: { _gt: '$NOW' } } },
		});

		await respond(req, res, next);

		// Skipped silently (KISS — no anomaly for an intentional hygiene skip).
		expect(vi.mocked(setCacheValue)).not.toHaveBeenCalled();
		expect(mocks.reportCacheAnomaly).not.toHaveBeenCalled();

		expect(mocks.queueMissLatency).toHaveBeenCalledWith(
			expect.any(Number),
			'other',
		);
	});

	test('a scoped-mode collection-less response flags missing_scope', async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValueOnce(true);
		const res = makeRes({ data: {} });
		const req = makeReq({ collection: undefined, originalUrl: '/server/info' });

		await respond(req, res, next);

		expect(vi.mocked(setCacheValue)).not.toHaveBeenCalled();

		expect(mocks.reportCacheAnomaly).toHaveBeenCalledWith(
			expect.any(Object),
			'missing_scope',
		);

		expect(mocks.queueMissLatency).toHaveBeenCalledWith(
			expect.any(Number),
			'anomaly',
		);
	});

	const scopedSchema = {
		collections: { articles: { scopedCacheFields: ['owner_field'] } },
		relations: [],
	} as unknown as Request['schema'];

	test(oneLine`
		a scoped collection tagged bare is marked coarse on the descriptor
	`, async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValueOnce(true);

		// articles has scoped_cache_fields but the read tagged bare (no value slice) →
		// over-purges → coarse recorded on the descriptor, not raised as an anomaly.
		const res = makeRes(
			{ data: [{ id: 1 }] },
			{
				scopedCacheFingerprints: [{
					collection: 'articles',
				}],
			},
		);

		await respond(makeReq({ schema: scopedSchema }), res, next);

		expect(vi.mocked(setCacheValue)).toHaveBeenCalled();

		expect(mocks.queueCacheDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({ coarse: true }),
		);
	});

	test('a value-pinned scoped fill is not coarse', async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValueOnce(true);

		// A value slice (field set) is a precise pin — not a coarse fallback.
		const res = makeRes(
			{ data: [{ id: 1 }] },
			{
				scopedCacheFingerprints: [
					{
						collection: 'articles',
						pinnedScope: { owner_field: ['u1'] },
					},
				],
			},
		);

		await respond(makeReq({ schema: scopedSchema }), res, next);

		expect(mocks.queueCacheDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({ coarse: false }),
		);
	});

	test(oneLine`
		the descriptor carries the tags in the same spelling the purge side records
	`, async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValueOnce(true);

		// A boolean slice, because that is where a re-implementation of the pin
		// would diverge: the driver hands back `1`, and only
		// `canonicalizeScopedCachePinValue` turns it into the `true` the Redis key and
		// the purge row both use. Written `=1` here, every purge of that slice
		// would fail to join back to this entry and its purge count would read 0.
		const res = makeRes(
			{ data: [{ id: 1 }] },
			{
				scopedCacheFingerprints: [
					{
						collection: 'articles',
						pinnedScope: { active: ['true'] },
					},
				],
			},
		);

		await respond(makeReq({ schema: scopedSchema }), res, next);

		expect(mocks.queueCacheDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({ scopedCachePins: ['articles:active=true'] }),
		);
	});

	test('a bare tag on a NON-scoped collection is not coarse', async () => {
		mocks.scopedCachePurgeEnabled.mockReturnValueOnce(true);

		// No scoped_cache_fields → the bare pin is the only correct pin, not a fallback.
		const res = makeRes(
			{ data: [{ id: 1 }] },
			{
				scopedCacheFingerprints: [{
					collection: 'articles',
				}],
			},
		);

		await respond(makeReq(), res, next);

		expect(mocks.queueCacheDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({ coarse: false }),
		);
	});

	test(oneLine`
		an oversized collection-less scoped response flags only value_too_large
	`, async () => {
		env['CACHE_VALUE_MAX_SIZE'] = '1b';
		mocks.scopedCachePurgeEnabled.mockReturnValueOnce(true);

		// Both preconditions hold (oversized AND orphan) — the else-if must pick the
		// size reason, never emit both for one request.
		const res = makeRes({ data: { blob: 'x'.repeat(100) } });
		const req = makeReq({ collection: undefined, originalUrl: '/server/info' });

		await respond(req, res, next);

		expect(mocks.reportCacheAnomaly).toHaveBeenCalledTimes(1);

		expect(mocks.reportCacheAnomaly).toHaveBeenCalledWith(
			expect.any(Object),
			'value_too_large',
			expect.stringMatching(/^\d+B$/),
		);

		expect(mocks.queueMissLatency).toHaveBeenCalledWith(
			expect.any(Number),
			'anomaly',
		);
	});

	test('res.locals.cache === false skips caching (no-cache branch)', async () => {
		const res = makeRes({ data: [] }, { cache: false });
		const req = makeReq();

		await respond(req, res, next);

		expect(indexScopedCacheEntry).not.toHaveBeenCalled();
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
		expect(indexScopedCacheEntry).toHaveBeenCalledWith(
			'cache-key',
			[{ collection: 'articles' }],
			[],
			{ collections: {}, relations: [] },
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
				scopedCacheFingerprints: [
					{
						collection: 'articles',
						pinnedScope: { owner: ['U1'] },
					},
				],
			},
		);

		await respond(makeReq(), res, next);

		expect(res.setHeader).toHaveBeenCalledWith(
			'X-Scoped-Cache-Tags',
			'articles:owner=U1',
		);

		expect(vi.mocked(setCacheValue)).toHaveBeenCalledWith(
			mockCache,
			'cache-key__tags',
			{ tags: ['articles:owner=U1'] },
			expect.any(Number),
		);

		expect(indexScopedCacheEntry).toHaveBeenCalledWith(
			'cache-key',
			[{ collection: 'articles', pinnedScope: { owner: ['U1'] } }],
			['cache-key__tags'],
			{ collections: {}, relations: [] },
		);
	});

	test('CACHE_PURGED_TAGS_HEADER emits purged tags on a mutation', async () => {
		env['CACHE_PURGED_TAGS_HEADER'] = 'X-Scoped-Cache-Purged-Tags';

		const res = makeRes(
			{ data: { id: 1 } },
			{
				scopedCachePurged: [
					{
						collection: 'articles',
						pinnedScope: { owner: ['U2'] },
					},
				],
			},
		);

		await respond(makeReq({ method: 'PATCH' }), res, next);

		expect(res.setHeader).toHaveBeenCalledWith(
			'X-Scoped-Cache-Purged-Tags',
			'articles:owner=U2',
		);
	});

	// The pin keeps the raw NUL (it is the Redis key), so the escaping has to happen
	// on the way out — `res.setHeader` throws ERR_INVALID_CHAR otherwise.
	test('escapes a control byte on its way into the header', async () => {
		env['CACHE_PURGED_TAGS_HEADER'] = 'X-Scoped-Cache-Purged-Tags';

		const res = makeRes(
			{ data: { id: 1 } },
			{
				scopedCachePurged: [
					{
						collection: 'articles',
						pinnedScope: { owner: ['\x00null'] },
					},
				],
			},
		);

		await respond(makeReq({ method: 'PATCH' }), res, next);

		expect(res.setHeader).toHaveBeenCalledWith(
			'X-Scoped-Cache-Purged-Tags',
			'articles:owner=%00null',
		);
	});

	// A batch write pins one tag per row; past CACHE_TAGS_HEADER_MAX_SIZE the header
	// stops and the __tags sibling still keeps every pin.
	test('clamps both tag headers, the sibling keeps every pin', async () => {
		env['CACHE_TAGS_HEADER'] = 'X-Scoped-Cache-Tags';
		env['CACHE_PURGED_TAGS_HEADER'] = 'X-Scoped-Cache-Purged-Tags';
		env['CACHE_TAGS_HEADER_MAX_SIZE'] = '5b';

		const purgedFingerprints = [
			{ collection: 'a', pinnedScope: { b: ['1'] } },
			{ collection: 'a', pinnedScope: { b: ['2'] } },
		];

		const res = makeRes(
			{ data: [{ id: 1 }] },
			{
				scopedCacheFingerprints: [
					{ collection: 'a', pinnedScope: { b: ['1', '2'] } },
				],
				scopedCachePurged: purgedFingerprints,
			},
		);

		await respond(makeReq(), res, next);

		expect(res.setHeader).toHaveBeenCalledWith('X-Scoped-Cache-Tags', 'a:b=1');
		expect(res.setHeader).toHaveBeenCalledWith('X-Scoped-Cache-Tags-omitted', '1');

		expect(res.setHeader).toHaveBeenCalledWith(
			'X-Scoped-Cache-Purged-Tags',
			'a:b=1',
		);

		expect(res.setHeader).toHaveBeenCalledWith(
			'X-Scoped-Cache-Purged-Tags-omitted',
			'1',
		);

		expect(vi.mocked(setCacheValue)).toHaveBeenCalledWith(
			mockCache,
			'cache-key__tags',
			{ tags: ['a:b=1', 'a:b=2'] },
			expect.any(Number),
		);
	});

	test('tag headers stay absent when their envs are unset', async () => {
		const res = makeRes(
			{ data: [] },
			{
				scopedCacheFingerprints: [{
					collection: 'articles',
				}],
				scopedCachePurged: [{ collection: 'articles' }],
			},
		);

		await respond(makeReq(), res, next);

		const names = vi.mocked(res.setHeader).mock.calls.map((call) => call[0]);
		expect(names).not.toContain('X-Scoped-Cache-Tags');
		expect(names).not.toContain('X-Scoped-Cache-Purged-Tags');
	});
});
