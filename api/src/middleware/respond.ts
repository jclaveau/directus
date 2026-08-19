import { useEnv } from '@directus/env';
import type { ScopedCacheTag } from '@directus/types';
import { parse as parseBytesConfiguration } from 'bytes';
import type { RequestHandler } from 'express';
import { getCache, setCacheValue } from '../cache.js';
import { resolvedCacheTtl } from '../cache-config.js';
import {
	cacheStatsActive,
	queueCacheDescriptor,
	queueMissLatency,
	writeCacheTombstone,
} from '../cache-events.js';
import getDatabase from '../database/index.js';
import { useLogger } from '../logger/index.js';
import {
	scopedCachePurgeEnabled,
	serializeScopedCacheTags,
	scopedCacheTagLabel,
	tagScopedCacheKeys,
} from '../scoped-cache.js';
import { ExportService } from '../services/import-export.js';
import { Meta } from '../types/meta.js';
import asyncHandler from '../utils/async-handler.js';
import { getCacheControlHeader } from '../utils/get-cache-headers.js';
import { getCacheKey } from '../utils/get-cache-key.js';
import {
	getGraphqlQueryAndVariables,
} from '../utils/get-graphql-query-and-variables.js';
import { reportCacheAnomaly } from '../utils/report-cache-anomaly.js';
import { getDateFormatted } from '../utils/get-date-formatted.js';
import { getMilliseconds } from '../utils/get-milliseconds.js';
import { stringByteSize } from '../utils/get-string-byte-size.js';
import { permissionsCachable } from '../utils/permissions-cachable.js';
import { queryCachable } from '../utils/query-cachable.js';

export const respond: RequestHandler = asyncHandler(async (req, res) => {
	const env = useEnv();
	const logger = useLogger();

	const { cache } = getCache();

	// Dev-only: CACHE_TAGS_HEADER / CACHE_PURGED_TAGS_HEADER name the headers (like
	// CACHE_STATUS_HEADER) exposing the scope tags a request pinned / purged, so a
	// smoke test can assert per-user scoping with no redis client. Never set in prod
	// — tags carry owner ids. Raw pins are emitted, so a regression pinning nothing
	// shows an absent header, not a masked one. A cache HIT skips this middleware —
	// pins are also written to a __tags sibling (below), re-emitted from cache.ts.
	if (env['CACHE_TAGS_HEADER']) {
		const pins = res.locals['scopedCacheTags'];

		if (Array.isArray(pins) && pins.length) {
			res.setHeader(
				`${env['CACHE_TAGS_HEADER']}`,
				serializeScopedCacheTags(pins),
			);
		}
	}

	if (env['CACHE_PURGED_TAGS_HEADER']) {
		const purged = res.locals['scopedCachePurged'];

		if (Array.isArray(purged) && purged.length) {
			res.setHeader(
				`${env['CACHE_PURGED_TAGS_HEADER']}`,
				serializeScopedCacheTags(purged),
			);
		}
	}

	let exceedsMaxSize = false;
	let valueSize = 0;

	if (env['CACHE_VALUE_MAX_SIZE'] !== false) {
		valueSize = res.locals['payload']
			? stringByteSize(JSON.stringify(res.locals['payload']))
			: 0;

		const maxSize = parseBytesConfiguration(env['CACHE_VALUE_MAX_SIZE'] as string);

		if (maxSize !== null) {
			exceedsMaxSize = valueSize > maxSize;
		}
	}

	// A custom read controller (e.g. /settings) may set `payload` with no tags
	// (ItemsService reads set them; a hand-written one often does not). Fall back to
	// the bare collection tag so a mutation there still purges it (settings reask).
	const collectionFallbackTags = req.collection
		? [{ collection: req.collection }]
		: [];

	const controllerTags = res.locals['scopedCacheTags'];

	// `total_count` drops the query filter and counts the whole collection
	// (`MetaService.totalCount`), so a response carrying it depends on every row —
	// including rows the read's own pins never bounded. An insert into another key
	// slice moves the number, and no pinned tag can express that. Such a response
	// keeps the bare collection tag beside its pins so any write drops it.
	const countsWholeCollection =
		req.sanitizedQuery.meta?.includes(Meta.TOTAL_COUNT) === true;

	const scopedCacheTags = controllerTags?.length && countsWholeCollection === false
		? controllerTags
		: [...(controllerTags ?? []), ...collectionFallbackTags];

	// No tags AND no collection (/server, /schema, a GraphQL query hitting nothing): a
	// scoped purge can never target it; caching would orphan a stale entry. Skip it.
	// Full mode's cache.clear() can't orphan, so it still caches.
	const orphansInScopedMode =
		scopedCacheTags.length === 0 && scopedCachePurgeEnabled();

	// A read hook scoped this response to unautopurgeable tags (value slices on fields
	// the target collection isn't scoped on) without `manuallyPurged`: no write can
	// auto-purge them, so caching would serve stale. Skip caching + surface them.
	const unautopurgeableScopeTags = res.locals['scopedCacheUnautopurgeableTags'] as
		| ScopedCacheTag[]
		| undefined;

	const unautopurgeableScope =
		Array.isArray(unautopurgeableScopeTags) &&
		unautopurgeableScopeTags.length > 0 &&
		scopedCachePurgeEnabled();

	// `$NOW` (in filter/deep) resolves to a Date in `sanitizeQuery` before the key is
	// built, so each request keys distinctly (not a staleness risk). But the key never
	// recurs: caching only writes a never-hit entry (Redis bloat + a bloated purge
	// set). Skip it. Unlike the permission gate (`permissionsCachable`), which IS
	// staleness: its filter isn't keyed.
	const dynamicQueryFilter =
		queryCachable(req.sanitizedQuery) === false;

	// The request-level preconditions for caching, minus the payload/scope/permission
	// gates below — reused to attribute a not-cached anomaly to the right reason.
	const cacheableRequest =
		(req.method.toLowerCase() === 'get' || req.originalUrl?.startsWith('/graphql')) &&
		req.originalUrl?.startsWith('/auth') === false &&
		env['CACHE_ENABLED'] === true &&
		!!cache &&
		!req.sanitizedQuery.export &&
		res.locals['cache'] !== false;

	let filled = false;

	if (
		cacheableRequest &&
		cache &&
		exceedsMaxSize === false &&
		orphansInScopedMode === false &&
		unautopurgeableScope === false &&
		dynamicQueryFilter === false &&
		(await permissionsCachable(
			req.collection,
			{
				knex: getDatabase(),
				schema: req.schema,
			},
			req.accountability,
		))
	) {
		filled = true;

		const { redisKey, cacheKey } = await getCacheKey(req);

		try {
			const now = Date.now();
			const ttlMs = getMilliseconds(resolvedCacheTtl());
			const expiresAt = now + getMilliseconds(resolvedCacheTtl(), 0);

			await setCacheValue(cache, redisKey, res.locals['payload'], ttlMs);

			// Enriched so a HIT reads age/TTL off this sibling — no extra read. Pass
			// `ttlMs` explicitly so it tracks the live override, not the Keyv default
			// TTL frozen at the response cache's construction.
			await setCacheValue(cache, `${redisKey}__expires_at`, {
				exp: expiresAt,
				createdAt: now,
				ttlMs: ttlMs ?? null,
			}, ttlMs);

			// Tombstone outlives the entry so a later miss can measure gap-since-expiry.
			void writeCacheTombstone(redisKey, expiresAt).catch(() => {});

			await tagScopedCacheKeys(
				redisKey,
				scopedCacheTags,
				env['CACHE_TAGS_HEADER']
					? [`${redisKey}__tags`]
					: [],
			);

			// Dev-only: persist pins next to the entry so a cache HIT (which skips
			// the read that builds them) can still emit them, via cache.ts.
			if (env['CACHE_TAGS_HEADER']) {
				const pins = res.locals['scopedCacheTags'];

				if (Array.isArray(pins) && pins.length) {
					// Object, not a bare string: setCacheValue's compress expects
					// a CacheValue (object) — a raw string won't round-trip.
					await setCacheValue(
						cache,
						`${redisKey}__tags`,
						{ tags: serializeScopedCacheTags(pins) },
						getMilliseconds(resolvedCacheTtl()),
					);
				}
			}

			// Gated at the call site (not just inside the buffer write): the default
			// config has stats off, and building these args re-serializes the payload
			// (size) and the query — a cost the hot fill path shouldn't pay when off.
			if (cacheStatsActive()) {
				try {
					const isGraphQlRequest = req.originalUrl?.startsWith('/graphql') === true;

					// Reuse the size the CACHE_VALUE_MAX_SIZE gate already computed (same
					// payload); only serialize again when that gate is off.
					let size = valueSize;

					if (env['CACHE_VALUE_MAX_SIZE'] === false) {
						size = res.locals['payload']
							? stringByteSize(JSON.stringify(res.locals['payload']))
							: 0;
					}

					// Coarse: a scoped collection read tagged bare (no value slice) caches
					// fine but over-purges — a tuning signal, on the descriptor.
					const scopedFields = req.collection
						? req.schema?.collections?.[req.collection]?.scopedCacheFields ?? []
						: [];

					const coarse =
						scopedCachePurgeEnabled() &&
						scopedFields.length > 0 &&
						scopedCacheTags.some(
							(tag) => tag.collection === req.collection && tag.field === undefined,
						);

					// Compute cost of this miss: request entry (cache mw) → response ready.
					const fillMs = Math.max(
						now - Number(res.locals['requestStart'] ?? now),
						0,
					);

					// The per-key descriptor — captured here (fill) where query/collection/
					// user are fully populated, unlike the early cache middleware. Buffered
					// like the events; the flusher upserts the descriptors dimension.
					void queueCacheDescriptor({
						cacheKey,
						redisKey,
						coarse,
						method: req.method,
						path: req.originalUrl.split('?')[0]!,
						collection: req.collection ?? null,
						userId: req.accountability?.user ?? null,
						query: isGraphQlRequest
							? JSON.stringify(getGraphqlQueryAndVariables(req))
							: JSON.stringify(req.sanitizedQuery ?? {}),
						// A GraphQL read is a POST — not a GET URL, so leave it blank.
						url: isGraphQlRequest
							? ''
							: req.originalUrl,
						bytes: size,
						fillMs,
						// The scoped cache tags the key was just indexed under, so a
						// later purge of any of them is attributable back to this
						// request.
						scopedCacheTags: scopedCacheTags.map(scopedCacheTagLabel),
					}).catch(() => {});

					// The same fill latency as a timestamped event (kind 'f') so the
					// median-latency chart can plot miss compute time over the window;
					// the descriptor above keeps only the latest per key.
					queueMissLatency(fillMs, 'fill', cacheKey);
				}
				catch (descriptorErr: any) {
					logger.warn(descriptorErr, '[cache-stats] descriptor capture failed');
				}
			}
		}
		catch (err: any) {
			logger.warn(err, `[cache] Couldn't set key ${redisKey}. ${err}`);

			if (cacheStatsActive()) {
				void reportCacheAnomaly(
					req,
					'redis_error',
					err?.message ?? String(err),
				).catch(() => {});
			}
		}

		res.setHeader(
			'Cache-Control',
			getCacheControlHeader(req, getMilliseconds(resolvedCacheTtl()), true, true),
		);

		res.setHeader('Vary', 'Origin, Cache-Control');
	}
	else {
		// Don't cache anything by default
		res.setHeader('Cache-Control', 'no-cache');
		res.setHeader('Vary', 'Origin, Cache-Control');
	}

	// Surface the silent "cacheable but skipped" reasons on the dashboard.
	if (cacheStatsActive() && cacheableRequest) {
		if (exceedsMaxSize) {
			void reportCacheAnomaly(
				req,
				'value_too_large',
				`${valueSize}B`,
			).catch(() => {});
		}
		else if (orphansInScopedMode) {
			void reportCacheAnomaly(req, 'missing_scope').catch(() => {});
		}
		else if (unautopurgeableScope) {
			// Dedup: aggregation (esp. GraphQL, many reads) can repeat the same tag.
			const detail = [
				...new Set(
					(unautopurgeableScopeTags ?? []).map(
						(tag) => `${tag.collection}:${tag.field}`,
					),
				),
			].join(', ');

			void reportCacheAnomaly(req, 'unautopurgeable_scope', detail).catch(() => {});
		}
	}

	// Every cacheable-by-method request reaching here was a miss (hits are served
	// in the cache middleware). Emit its compute latency so the "Misses" curve
	// pools all misses: the fill above covered the cached ones; this covers the
	// uncacheable rest, split anomaly (flagged just above) vs silently skipped.
	if (cacheStatsActive() && cacheableRequest && !filled) {
		const missMs = Math.max(
			Date.now() - Number(res.locals['requestStart'] ?? Date.now()),
			0,
		);

		const anomalous =
			exceedsMaxSize || orphansInScopedMode || unautopurgeableScope;

		queueMissLatency(
			missMs,
			anomalous
				? 'anomaly'
				: 'other',
		);
	}

	if (req.sanitizedQuery.export) {
		const exportService = new ExportService({ accountability: req.accountability ?? null, schema: req.schema });

		let filename = '';

		if (req.collection) {
			filename += req.collection;
		}
		else {
			filename += 'Export';
		}

		filename += ` ${getDateFormatted()}`;

		if (req.sanitizedQuery.export === 'json') {
			res.attachment(`${filename}.json`);
			res.set('Content-Type', 'application/json');
			return res.status(200).send(exportService.transform(res.locals['payload']?.data, 'json'));
		}

		if (req.sanitizedQuery.export === 'xml') {
			res.attachment(`${filename}.xml`);
			res.set('Content-Type', 'text/xml');
			return res.status(200).send(exportService.transform(res.locals['payload']?.data, 'xml'));
		}

		if (req.sanitizedQuery.export === 'csv') {
			res.attachment(`${filename}.csv`);
			res.set('Content-Type', 'text/csv');
			return res.status(200).send(exportService.transform(res.locals['payload']?.data, 'csv'));
		}

		if (req.sanitizedQuery.export === 'yaml') {
			res.attachment(`${filename}.yaml`);
			res.set('Content-Type', 'text/yaml');
			return res.status(200).send(exportService.transform(res.locals['payload']?.data, 'yaml'));
		}
	}

	if (Buffer.isBuffer(res.locals['payload'])) {
		return res.end(res.locals['payload']);
	}
	else if (res.locals['payload']) {
		return res.json(res.locals['payload']);
	}
	else {
		return res.status(204).end();
	}
});
