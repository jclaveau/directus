import { getMilliseconds } from "../utils/get-milliseconds.js";
import { useLogger } from "../logger/index.js";
import { scopedCacheTagLabel, serializeScopedCacheTags } from "../scoped-cache/tags.js";
import database_default from "../database/index.js";
import { resolvedCacheTtl } from "../cache-config.js";
import { printableScopedCacheTags } from "../utils/printable-scoped-cache-tags.js";
import { cacheStatsActive, queueCacheDescriptor, queueMissLatency, writeCacheTombstone } from "../cache-events.js";
import { readScopedCacheEpochs, scopedCachePurgeEnabled, tagScopedCacheKeys } from "../scoped-cache/purge.js";
import "../scoped-cache.js";
import { getCache, setCacheValue } from "../cache.js";
import { getDateFormatted } from "../utils/get-date-formatted.js";
import async_handler_default from "../utils/async-handler.js";
import { Meta } from "../types/meta.js";
import { stringByteSize } from "../utils/get-string-byte-size.js";
import { ExportService } from "../services/import-export.js";
import { getCacheControlHeader } from "../utils/get-cache-headers.js";
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
	if (env["CACHE_TAGS_HEADER"]) {
		const pins = res.locals["scopedCacheTags"];
		if (Array.isArray(pins) && pins.length) res.setHeader(`${env["CACHE_TAGS_HEADER"]}`, printableScopedCacheTags(serializeScopedCacheTags(pins)));
	}
	if (env["CACHE_PURGED_TAGS_HEADER"]) {
		const purged = res.locals["scopedCachePurged"];
		if (Array.isArray(purged) && purged.length) res.setHeader(`${env["CACHE_PURGED_TAGS_HEADER"]}`, printableScopedCacheTags(serializeScopedCacheTags(purged)));
	}
	let exceedsMaxSize = false;
	let valueSize = 0;
	if (env["CACHE_VALUE_MAX_SIZE"] !== false) {
		valueSize = res.locals["payload"] ? stringByteSize(JSON.stringify(res.locals["payload"])) : 0;
		const maxSize = parse(env["CACHE_VALUE_MAX_SIZE"]);
		if (maxSize !== null) exceedsMaxSize = valueSize > maxSize;
	}
	const collectionFallbackTags = req.collection ? [{ collection: req.collection }] : [];
	const controllerTags = res.locals["scopedCacheTags"];
	const countsWholeCollection = req.sanitizedQuery.meta?.includes(Meta.TOTAL_COUNT) === true;
	const scopedCacheTags = controllerTags?.length && countsWholeCollection === false ? controllerTags : [...controllerTags ?? [], ...collectionFallbackTags];
	const orphansInScopedMode = scopedCacheTags.length === 0 && scopedCachePurgeEnabled();
	const unautopurgeableScopeTags = res.locals["scopedCacheUnautopurgeableTags"];
	const unautopurgeableScope = Array.isArray(unautopurgeableScopeTags) && unautopurgeableScopeTags.length > 0 && scopedCachePurgeEnabled();
	const dynamicQueryFilter = queryCachable(req.sanitizedQuery) === false;
	const cacheableRequest = (req.method.toLowerCase() === "get" || req.originalUrl?.startsWith("/graphql")) && req.originalUrl?.startsWith("/auth") === false && env["CACHE_ENABLED"] === true && !!cache && !req.sanitizedQuery.export && res.locals["cache"] !== false;
	const capturedEpochs = res.locals["scopedCacheEpochs"];
	const currentEpochs = cacheableRequest && cache && capturedEpochs ? await readScopedCacheEpochs(Object.keys(capturedEpochs)) : {};
	const racedCollection = Object.entries(capturedEpochs ?? {}).find(([collection, captured]) => {
		return currentEpochs[collection] !== captured;
	})?.[0];
	let filled = false;
	if (cacheableRequest && cache && exceedsMaxSize === false && orphansInScopedMode === false && unautopurgeableScope === false && dynamicQueryFilter === false && racedCollection === void 0 && await permissionsCachable(req.collection, {
		knex: database_default(),
		schema: req.schema
	}, req.accountability)) {
		filled = true;
		const { redisKey, cacheKey } = await getCacheKey(req);
		try {
			const now = Date.now();
			const ttlMs = getMilliseconds(resolvedCacheTtl());
			const expiresAt = now + getMilliseconds(resolvedCacheTtl(), 0);
			await tagScopedCacheKeys(redisKey, scopedCacheTags, env["CACHE_TAGS_HEADER"] ? [`${redisKey}__tags`] : []);
			await setCacheValue(cache, redisKey, res.locals["payload"], ttlMs);
			await setCacheValue(cache, `${redisKey}__expires_at`, {
				exp: expiresAt,
				createdAt: now,
				ttlMs: ttlMs ?? null
			}, ttlMs);
			if (capturedEpochs) {
				const epochsAfterFill = await readScopedCacheEpochs(Object.keys(capturedEpochs));
				const sweptDuringFill = Object.entries(capturedEpochs).find(([collection, captured]) => {
					return epochsAfterFill[collection] !== captured;
				})?.[0];
				if (sweptDuringFill !== void 0) {
					await cache.delete(redisKey);
					await cache.delete(`${redisKey}__expires_at`);
					if (cacheStatsActive()) reportCacheAnomaly(req, "inflight_purge", sweptDuringFill).catch(() => {});
				}
			}
			writeCacheTombstone(redisKey, expiresAt).catch(() => {});
			if (env["CACHE_TAGS_HEADER"]) {
				const pins = res.locals["scopedCacheTags"];
				if (Array.isArray(pins) && pins.length) await setCacheValue(cache, `${redisKey}__tags`, { tags: serializeScopedCacheTags(pins) }, getMilliseconds(resolvedCacheTtl()));
			}
			if (cacheStatsActive()) try {
				const isGraphQlRequest = req.originalUrl?.startsWith("/graphql") === true;
				let size = valueSize;
				if (env["CACHE_VALUE_MAX_SIZE"] === false) size = res.locals["payload"] ? stringByteSize(JSON.stringify(res.locals["payload"])) : 0;
				const scopedFields = req.collection ? req.schema?.collections?.[req.collection]?.scopedCacheFields ?? [] : [];
				const coarse = scopedCachePurgeEnabled() && scopedFields.length > 0 && scopedCacheTags.some((tag) => tag.collection === req.collection && tag.field === void 0);
				const fillMs = Math.max(now - Number(res.locals["requestStart"] ?? now), 0);
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
					scopedCacheTags: scopedCacheTags.map(scopedCacheTagLabel)
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
		else if (racedCollection !== void 0) reportCacheAnomaly(req, "inflight_purge", racedCollection).catch(() => {});
		else if (unautopurgeableScope) reportCacheAnomaly(req, "unautopurgeable_scope", [...new Set((unautopurgeableScopeTags ?? []).map((tag) => `${tag.collection}:${tag.field}`))].join(", ")).catch(() => {});
	}
	if (cacheStatsActive() && cacheableRequest && !filled) queueMissLatency(Math.max(Date.now() - Number(res.locals["requestStart"] ?? Date.now()), 0), exceedsMaxSize || orphansInScopedMode || unautopurgeableScope ? "anomaly" : "other");
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