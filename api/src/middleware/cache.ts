import { useEnv } from '@directus/env';
import type { RequestHandler } from 'express';
import { getCache, getCacheValue } from '../cache.js';
import { resolvedCacheTtl } from '../cache-config.js';
import {
	cacheStatsActive,
	queueCacheHit,
	queueCacheMiss,
	readCacheMissGap,
} from '../cache-events.js';
import { headerSafeScopedCacheTags } from '../scoped-cache.js';
import { reportCacheAnomaly } from '../utils/report-cache-anomaly.js';
import { useLogger } from '../logger/index.js';
import { useMetrics } from '../metrics/index.js';
import asyncHandler from '../utils/async-handler.js';
import { getCacheControlHeader } from '../utils/get-cache-headers.js';
import { getMilliseconds } from '../utils/get-milliseconds.js';
import { getCacheKey } from '../utils/get-cache-key.js';
import { shouldSkipCache } from '../utils/should-skip-cache.js';

const checkCacheMiddleware: RequestHandler = asyncHandler(async (req, res, next) => {
	const env = useEnv();
	const { cache } = getCache();
	const logger = useLogger();

	if (req.method.toLowerCase() !== 'get' && req.originalUrl?.startsWith('/graphql') === false) return next();
	if (env['CACHE_ENABLED'] !== true) return next();
	if (!cache) return next();

	// Reference point for the request→response duration telemetry: cache-serve
	// latency on a HIT, response compute time (read by respond.ts) on a MISS.
	res.locals['requestStart'] = Date.now();

	if (shouldSkipCache(req)) {
		if (env['CACHE_STATUS_HEADER']) res.setHeader(`${env['CACHE_STATUS_HEADER']}`, 'MISS');
		return next();
	}

	const { redisKey, cacheKey } = await getCacheKey(req);

	let cachedData;

	try {
		cachedData = await getCacheValue(cache, redisKey);
	} catch (err: any) {
		logger.warn(err, `[cache] Couldn't read key ${redisKey}. ${err.message}`);

		if (cacheStatsActive()) {
			void reportCacheAnomaly(
				req,
				'redis_error',
				err?.message ?? String(err),
			).catch(() => {});
		}

		if (env['CACHE_STATUS_HEADER']) res.setHeader(`${env['CACHE_STATUS_HEADER']}`, 'MISS');
		return next();
	}

	if (cachedData) {
		let cacheExpiryDate;
		let expiresMeta;

		try {
			expiresMeta = await getCacheValue(cache, `${redisKey}__expires_at`);
			cacheExpiryDate = expiresMeta?.exp;
		} catch (err: any) {
			logger.warn(
				err,
				`[cache] Couldn't read key ${redisKey}__expires_at. ${err.message}`,
			);

			if (cacheStatsActive()) {
				void reportCacheAnomaly(
					req,
					'redis_error',
					err?.message ?? String(err),
				).catch(() => {});
			}

			if (env['CACHE_STATUS_HEADER']) res.setHeader(`${env['CACHE_STATUS_HEADER']}`, 'MISS');
			return next();
		}

		const cacheTTL = cacheExpiryDate ? cacheExpiryDate - Date.now() : undefined;

		res.setHeader('Cache-Control', getCacheControlHeader(req, cacheTTL, true, true));
		res.setHeader('Vary', 'Origin, Cache-Control');
		if (env['CACHE_STATUS_HEADER']) res.setHeader(`${env['CACHE_STATUS_HEADER']}`, 'HIT');

		// Aggregate hit-ratio on the /metrics endpoint (in-memory counter, no opt-in).
		useMetrics()
			?.getCacheResponseMetric()
			?.inc({ result: 'hit' });

		// Fire-and-forget hit telemetry for TTL tuning — age/TTL come off the
		// sibling just read above, so no extra round-trip. Keyed by the cache key;
		// the descriptor is written on fill (respond.ts). Skipped for pre-
		// enrichment entries (no createdAt), killable at runtime, never blocks.
		const createdAt = Number(expiresMeta?.createdAt ?? 0);

		if (cacheStatsActive() && createdAt > 0) {
			void queueCacheHit({
				cacheKey,
				ageMs: Math.max(Date.now() - createdAt, 0),
				ttlMs: expiresMeta?.ttlMs ?? null,
				durationMs: Math.max(Date.now() - Number(res.locals['requestStart']), 0),
			}).catch(() => {});
		}

		if (env['CACHE_TAGS_HEADER']) {
			// Dev-only: pins were persisted to a `${redisKey}__tags` sibling at write
			// time (respond.ts); the read that builds them is skipped on a HIT.
			try {
				const stored = await getCacheValue(cache, `${redisKey}__tags`);

				if (stored?.tags) {
					res.setHeader(
						`${env['CACHE_TAGS_HEADER']}`,
						headerSafeScopedCacheTags(stored.tags),
					);
				}
			}
			catch (err: any) {
				logger.warn(err, `[cache] __tags read failed: ${err.message}`);
			}
		}

		return res.json(cachedData);
	} else {
		if (env['CACHE_STATUS_HEADER']) res.setHeader(`${env['CACHE_STATUS_HEADER']}`, 'MISS');

		useMetrics()
			?.getCacheResponseMetric()
			?.inc({ result: 'miss' });

		// A cacheable request that wasn't cached = real demand. The tombstone (if
		// any) turns it into a gap-since-expiry — the signal for lengthening TTL.
		if (cacheStatsActive()) {
			const missAt = Date.now();

			void readCacheMissGap(redisKey, missAt)
				.then((gapMs) => {
					return queueCacheMiss({
						cacheKey,
						gapMs,
						ttlMs: getMilliseconds(resolvedCacheTtl()) ?? null,
					});
				})
				.catch(() => {});
		}

		return next();
	}
});

export default checkCacheMiddleware;
