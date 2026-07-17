import type { Request } from 'express';
import {
	captureCacheAnomaly,
	captureCacheDescriptor,
	type CacheAnomalyReason,
} from '../cache-events.js';
import { getCacheKey } from './get-cache-key.js';
import { getGraphqlQueryAndVariables } from './get-graphql-query-and-variables.js';

/**
 * Record an anomaly for a request that was NOT cached. Writes a descriptor first so
 * the anomaly's cache_key ref resolves to a path/method/query node in the admin
 * tree, then the anomaly. bytes/fillMs are 0 — the descriptor is a locator, not a
 * cached entry (no events, so it never shows in the entries listing). Best-effort:
 * both writes go to the Redis stream, so a full Redis outage records nothing.
 */
export async function recordUncachedAnomaly(
	req: Request,
	reason: CacheAnomalyReason,
	detail?: string | null,
): Promise<void> {
	const { key, hash } = await getCacheKey(req);
	const isGraphQl = req.originalUrl?.startsWith('/graphql') === true;

	await captureCacheDescriptor({
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
	});

	await captureCacheAnomaly({ cacheKey: hash, reason, detail: detail ?? null });
}
