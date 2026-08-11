import type { Request } from 'express';
import {
	queueCacheDescriptor,
	claimCacheAnomalyThrottleSlot,
	queueCacheAnomaly,
	type CacheAnomalyReason,
} from '../cache-events.js';
import { getCacheKey } from './get-cache-key.js';
import { getGraphqlQueryAndVariables } from './get-graphql-query-and-variables.js';

/**
 * Record an anomaly for a request that was NOT cached. Claims the throttle slot
 * first so a hot uncached path can't flood the stream with per-request locator
 * descriptors; on a claim it writes a locator descriptor (so the anomaly's
 * cache_key ref resolves to a path/method/query node in the admin tree), then the
 * anomaly. bytes/fillMs are 0 — a locator, not a cached entry. Best-effort: both
 * writes go to the Redis stream, so a full Redis outage records nothing.
 */
export async function reportCacheAnomaly(
	req: Request,
	reason: CacheAnomalyReason,
	detail?: string | null,
): Promise<void> {
	const { key, hash } = await getCacheKey(req);

	if (!(await claimCacheAnomalyThrottleSlot(reason, hash))) {
		return;
	}

	const isGraphQl = req.originalUrl?.startsWith('/graphql') === true;

	await queueCacheDescriptor({
		cacheKey: hash,
		redisKey: key,
		coarse: false,
		method: req.method,
		path: req.originalUrl.split('?')[0]!,
		collection: req.collection ?? null,
		userId: req.accountability?.user ?? null,
		query: isGraphQl
			? JSON.stringify(getGraphqlQueryAndVariables(req))
			: JSON.stringify(req.sanitizedQuery ?? {}),
		url: isGraphQl
			? ''
			: req.originalUrl,
		bytes: 0,
		fillMs: 0,
		// A locator is written where the read never got far enough to resolve a
		// scope, so it carries none — the drain records tags for real fills only.
		tags: [],
		lastFilled: null,
	});

	queueCacheAnomaly({ cacheKey: hash, reason, detail: detail ?? null });
}
