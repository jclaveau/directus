import { getMilliseconds } from "../utils/get-milliseconds.js";
import { useLogger } from "../logger/index.js";
import { renderScopedCacheFingerprint, scopedCacheFingerprintIsBare, scopedCachePinKeys } from "../scoped-cache/fingerprint.js";
import { scopedCachePurgeEnabled } from "../scoped-cache/config.js";
import { mergedScopedCacheEpochs, scopedCacheCollectionsWithoutGuard, scopedCacheSweptDuringFill } from "../scoped-cache/fill-guard.js";
import { scopedCacheFillPaused } from "../scoped-cache/fill-pause.js";
import database_default from "../database/index.js";
import emitter_default from "../emitter.js";
import { resolvedCacheTtl } from "../cache-config.js";
import { cacheExpiresAtKey, cachePinsKey } from "../cache-sidecars.js";
import { storedScopedCachePin } from "../utils/printable-scoped-cache-pins.js";
import { cacheStatsActive, evictCacheEntry, queueCacheDescriptor, queueMissLatency, writeCacheTombstone } from "../cache-events.js";
import { recordPendingScopedCachePurge } from "../scoped-cache-pending-purges.js";
import { indexScopedCacheEntry } from "../scoped-cache/purge.js";
import "../scoped-cache/index.js";
import { getCache, setCacheValue } from "../cache.js";
import { readMeta } from "../utils/read-meta.js";
import { getDateFormatted } from "../utils/get-date-formatted.js";
import async_handler_default from "../utils/async-handler.js";
import { Meta } from "../types/meta.js";
import { CACHE_AUDIT_PINS_HEADER, isCacheAuditReplay } from "../utils/cache-audit-replay.js";
import { stringByteSize } from "../utils/get-string-byte-size.js";
import { ExportService } from "../services/import-export.js";
import { getCacheControlHeader } from "../utils/get-cache-headers.js";
import { setScopedCachePinsHeader } from "../utils/scoped-cache-pins-header.js";
import { getGraphqlQueryAndVariables } from "../utils/get-graphql-query-and-variables.js";
import { getCacheKey } from "../utils/get-cache-key.js";
import { reportCacheAnomaly } from "../utils/report-cache-anomaly.js";
import { permissionsCachable } from "../utils/permissions-cachable.js";
import { queryCachable } from "../utils/query-cachable.js";
import { useEnv } from "@directus/env";
import { parse } from "bytes";

//#region src/middleware/respond.ts
const respond = async_handler_default(async (req, res) => {
	const env = useEnv();
	const logger = useLogger();
	const { cache } = getCache();
	const payloadMeta = readMeta(res.locals["payload"]?.data);
	const readFingerprints = res.locals["scopedCacheFingerprints"] ?? payloadMeta?.scopedCacheFingerprints ?? [];
	const readPinKeys = scopedCachePinKeys(readFingerprints);
	if (env["CACHE_TAGS_HEADER"]) {
		if (readPinKeys.length > 0) setScopedCachePinsHeader(res, `${env["CACHE_TAGS_HEADER"]}`, readPinKeys);
	}
	if (env["CACHE_PURGED_TAGS_HEADER"]) {
		const purged = res.locals["scopedCachePurged"];
		if (Array.isArray(purged) && purged.length) setScopedCachePinsHeader(res, `${env["CACHE_PURGED_TAGS_HEADER"]}`, scopedCachePinKeys(purged));
	}
	let exceedsMaxSize = false;
	let valueSize = 0;
	if (env["CACHE_VALUE_MAX_SIZE"] !== false) {
		valueSize = res.locals["payload"] ? stringByteSize(JSON.stringify(res.locals["payload"])) : 0;
		const maxSize = parse(env["CACHE_VALUE_MAX_SIZE"]);
		if (maxSize !== null) exceedsMaxSize = valueSize > maxSize;
	}
	const collectionFallbackFingerprints = req.collection ? [{ collection: req.collection }] : [];
	const countsWholeCollection = req.sanitizedQuery.meta?.includes(Meta.TOTAL_COUNT) === true;
	const pinnedFingerprints = readFingerprints.length > 0 ? readFingerprints : collectionFallbackFingerprints;
	const scopedCacheFingerprints = countsWholeCollection && req.collection ? [...readFingerprints.filter((readFingerprint) => {
		return readFingerprint.collection !== req.collection;
	}), ...collectionFallbackFingerprints] : pinnedFingerprints;
	const indexedPinKeys = scopedCachePinKeys(scopedCacheFingerprints);
	if (isCacheAuditReplay(req)) res.setHeader(CACHE_AUDIT_PINS_HEADER, JSON.stringify(indexedPinKeys.map(storedScopedCachePin)));
	const orphansInScopedMode = scopedCacheFingerprints.length === 0 && scopedCachePurgeEnabled();
	const unautopurgeableFingerprints = res.locals["scopedCacheUnautopurgeableFingerprints"] ?? payloadMeta?.scopedCacheUnautopurgeableFingerprints;
	const unautopurgeableScope = Array.isArray(unautopurgeableFingerprints) && unautopurgeableFingerprints.length > 0 && scopedCachePurgeEnabled();
	const dynamicQueryFilter = queryCachable(req.sanitizedQuery) === false;
	const cacheableRequest = (req.method.toLowerCase() === "get" || req.originalUrl?.startsWith("/graphql")) && req.originalUrl?.startsWith("/auth") === false && env["CACHE_ENABLED"] === true && !!cache && !req.sanitizedQuery.export && res.locals["cache"] !== false;
	const epochsBeforeQuery = mergedScopedCacheEpochs(res.locals["scopedCacheEpochsBeforeQuery"], res.locals["scopedCacheEpochs"] ?? payloadMeta?.scopedCacheEpochs);
	const unguardedScopeCollections = scopedCacheCollectionsWithoutGuard(epochsBeforeQuery, scopedCacheFingerprints);
	const unguardedScope = unguardedScopeCollections.length > 0;
	let filled = false;
	if (cacheableRequest && cache && exceedsMaxSize === false && orphansInScopedMode === false && unautopurgeableScope === false && unguardedScope === false && dynamicQueryFilter === false && scopedCacheFillPaused() === false && await permissionsCachable(req.collection, {
		knex: database_default(),
		schema: req.schema
	}, req.accountability)) {
		filled = true;
		const { redisKey, cacheKey } = res.locals["httpRequestCacheKey"] ?? await getCacheKey(req);
		try {
			const now = Date.now();
			const cacheTtl = resolvedCacheTtl();
			const ttlMs = getMilliseconds(cacheTtl);
			const expiresAt = now + getMilliseconds(cacheTtl, 0);
			await indexScopedCacheEntry(redisKey, scopedCacheFingerprints, env["CACHE_TAGS_HEADER"] ? [cachePinsKey(redisKey)] : [], req.schema, cacheTtl);
			await emitter_default.emitAction("cache.indexed", {
				redisKey,
				fingerprints: scopedCacheFingerprints
			});
			await Promise.all([setCacheValue(cache, redisKey, res.locals["payload"], ttlMs), cache.set(cacheExpiresAtKey(redisKey), {
				exp: expiresAt,
				createdAt: now,
				ttlMs: ttlMs ?? null
			}, ttlMs)]);
			const filledAt = Date.now();
			let sweptDuringFill;
			if (epochsBeforeQuery) {
				sweptDuringFill = await scopedCacheSweptDuringFill(epochsBeforeQuery);
				if (sweptDuringFill !== void 0) {
					if (await evictCacheEntry(cache, redisKey) === false) {
						const error = /* @__PURE__ */ new Error(`in-flight purge of ${sweptDuringFill} left ${redisKey} cached`);
						logger.warn(error, `[scoped-cache] eviction failed and was recorded for retry: ${error}`);
						await recordPendingScopedCachePurge({
							mode: "slices",
							collection: req.collection ?? null,
							scopedCacheFingerprints: scopedCacheFingerprints.map(renderScopedCacheFingerprint)
						}, error);
					}
					if (cacheStatsActive()) reportCacheAnomaly(req, "inflight_purge", sweptDuringFill).catch(() => {});
				}
			}
			writeCacheTombstone(redisKey, expiresAt).catch(() => {});
			if (env["CACHE_TAGS_HEADER"] && sweptDuringFill === void 0) {
				if (readPinKeys.length > 0) await setCacheValue(cache, cachePinsKey(redisKey), { pins: readPinKeys }, ttlMs);
			}
			if (cacheStatsActive()) try {
				const isGraphQlRequest = req.originalUrl?.startsWith("/graphql") === true;
				let size = valueSize;
				if (env["CACHE_VALUE_MAX_SIZE"] === false) size = res.locals["payload"] ? stringByteSize(JSON.stringify(res.locals["payload"])) : 0;
				const scopedFields = req.collection ? req.schema?.collections?.[req.collection]?.scopedCacheFields ?? [] : [];
				const coarse = scopedCachePurgeEnabled() && scopedFields.length > 0 && scopedCacheFingerprints.some((fingerprint) => {
					return fingerprint.collection === req.collection && scopedCacheFingerprintIsBare(fingerprint);
				});
				const fillMs = Math.max(filledAt - Number(res.locals["requestStart"] ?? filledAt), 0);
				queueCacheDescriptor({
					cacheKey,
					redisKey,
					coarse,
					method: req.method,
					path: req.originalUrl.split("?")[0],
					collection: req.collection ?? null,
					userId: req.accountability?.user ?? null,
					query: isGraphQlRequest ? JSON.stringify(getGraphqlQueryAndVariables(req)) : req.originalUrl.split("?")[1] ?? "",
					bytes: size,
					fillMs,
					scopedCachePins: indexedPinKeys
				}).catch(() => {});
				queueMissLatency(fillMs, "fill", cacheKey);
			} catch (descriptorErr) {
				logger.warn(descriptorErr, "[cache-stats] descriptor capture failed");
			}
		} catch (err) {
			logger.warn(err, `[cache] Couldn't set key ${redisKey}. ${err}`);
			if (cacheStatsActive()) reportCacheAnomaly(req, "redis_error", err?.message ?? String(err)).catch(() => {});
		}
		res.setHeader("Cache-Control", getCacheControlHeader(req, getMilliseconds(resolvedCacheTtl()), true, true));
		res.setHeader("Vary", "Origin, Cache-Control");
	} else {
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Vary", "Origin, Cache-Control");
	}
	if (cacheStatsActive() && cacheableRequest) {
		if (exceedsMaxSize) reportCacheAnomaly(req, "value_too_large", `${valueSize}B`).catch(() => {});
		else if (orphansInScopedMode) reportCacheAnomaly(req, "missing_scope").catch(() => {});
		else if (unautopurgeableScope) reportCacheAnomaly(req, "unautopurgeable_scope", [...new Set((unautopurgeableFingerprints ?? []).flatMap((fingerprint) => {
			return Object.keys(fingerprint.pinnedScope ?? {}).map((field) => {
				return `${fingerprint.collection}:${field}`;
			});
		}))].join(", ")).catch(() => {});
		else if (unguardedScope) reportCacheAnomaly(req, "unguarded_scope", unguardedScopeCollections.join(", ")).catch(() => {});
	}
	if (cacheStatsActive() && cacheableRequest && !filled) queueMissLatency(Math.max(Date.now() - Number(res.locals["requestStart"] ?? Date.now()), 0), exceedsMaxSize || orphansInScopedMode || unautopurgeableScope || unguardedScope ? "anomaly" : "other");
	if (req.sanitizedQuery.export) {
		const exportService = new ExportService({
			accountability: req.accountability ?? null,
			schema: req.schema
		});
		let filename = "";
		if (req.collection) filename += req.collection;
		else filename += "Export";
		filename += ` ${getDateFormatted()}`;
		if (req.sanitizedQuery.export === "json") {
			res.attachment(`${filename}.json`);
			res.set("Content-Type", "application/json");
			return res.status(200).send(exportService.transform(res.locals["payload"]?.data, "json"));
		}
		if (req.sanitizedQuery.export === "xml") {
			res.attachment(`${filename}.xml`);
			res.set("Content-Type", "text/xml");
			return res.status(200).send(exportService.transform(res.locals["payload"]?.data, "xml"));
		}
		if (req.sanitizedQuery.export === "csv") {
			res.attachment(`${filename}.csv`);
			res.set("Content-Type", "text/csv");
			return res.status(200).send(exportService.transform(res.locals["payload"]?.data, "csv"));
		}
		if (req.sanitizedQuery.export === "yaml") {
			res.attachment(`${filename}.yaml`);
			res.set("Content-Type", "text/yaml");
			return res.status(200).send(exportService.transform(res.locals["payload"]?.data, "yaml"));
		}
	}
	if (Buffer.isBuffer(res.locals["payload"])) return res.end(res.locals["payload"]);
	else if (res.locals["payload"]) return res.json(res.locals["payload"]);
	else return res.status(204).end();
});

//#endregion
export { respond };