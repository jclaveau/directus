import { getMilliseconds } from "./utils/get-milliseconds.js";
import { useLogger } from "./logger/index.js";
import { useRedis } from "./redis/lib/use-redis.js";
import { redisConfigAvailable } from "./redis/utils/redis-config-available.js";
import "./redis/index.js";
import { useBus } from "./bus/lib/use-bus.js";
import "./bus/index.js";
import database_default from "./database/index.js";
import { resolvedCacheTtl } from "./cache-config.js";
import { printableScopedCacheTags } from "./utils/printable-scoped-cache-tags.js";
import { useEnv } from "@directus/env";
import { parse } from "bytes";
import { randomUUID } from "node:crypto";

//#region src/cache-events.ts
const CACHE_LATENCY_METRICS = [
	"response",
	"miss",
	"anomaly",
	"fill",
	"hit"
];
const DEFAULT_STREAM_CAP = 1e6;
const EVENT_KIND_CODE = {
	h: 0,
	m: 1,
	f: 2,
	x: 3,
	o: 4
};
const MISS_LATENCY_KIND = {
	fill: "f",
	anomaly: "x",
	other: "o"
};
const STREAM_GROUP = "drain";
const CONSUMER_NAME = randomUUID();
const PENDING_RECLAIM_AFTER = getMilliseconds("60s", 6e4);
const FLUSH_BATCH = 500;
const DEFAULT_GAP_LOOKBACK = getMilliseconds("1h", 36e5);
const DEFAULT_CACHE_STATS_WINDOW = getMilliseconds("24h", 864e5);
const MIN_CACHE_STATS_WINDOW = getMilliseconds("1m", 6e4);
const CACHE_STATS_LISTING_LIMIT = 200;
const DEFAULT_CACHE_ENTRIES_WINDOW = getMilliseconds("10m", 6e5);
const DEFAULT_CACHE_LATENCIES_WINDOW = getMilliseconds("10m", 6e5);
const CACHE_ENTRY_PURGE_LIMIT = 50;
const DIMENSION_REAP_BATCH = 5e3;
const DIMENSION_REAP_PASSES = 4;
const CACHE_STATS_FACTS = [
	"directus_cache_stats_events",
	"directus_cache_stats_purges",
	"directus_cache_stats_scoped_purge_tags"
];
const CACHE_STATS_TABLES = [
	...CACHE_STATS_FACTS,
	"directus_cache_stats_descriptors",
	"directus_cache_stats_scoped_entry_tags",
	"directus_cache_stats_anomalies",
	"directus_cache_stats_config_events"
];
const CACHE_STATS_BUDGET_LOW_WATER = .9;
const CACHE_STATS_MIN_RETENTION = getMilliseconds("6h", 216e5);
const CACHE_STATS_EVICTIONS_PER_TICK = 8;
const DEFAULT_RETENTION = getMilliseconds("30d", 2592e6);
const ANOMALY_THROTTLE_MS = getMilliseconds("1m", 6e4);
let cacheStatsActiveFlag = false;
let cacheEventDrainInProgress = false;
function statsNamespace() {
	return `${useEnv()["CACHE_NAMESPACE"]}:stats`;
}
const streamKey = () => `${statsNamespace()}:events`;
const flagKey = () => `${statsNamespace()}:enabled`;
const budgetAlertKey = () => `${statsNamespace()}:budget_alert`;
const tombstoneKey = (redisKey) => `${statsNamespace()}:tomb:${redisKey}`;
const anomalyThrottleKey = (reason, cacheKey) => `${statsNamespace()}:anom:${reason}:${cacheKey}`;
/**
* Master switch: opt-in (CACHE_STATS_ENABLED, default off) AND Redis reachable
* (buffer + flag live there). The runtime flag can only narrow this, never widen.
*/
function cacheStatsConfigured() {
	return useEnv()["CACHE_STATS_ENABLED"] === true && redisConfigAvailable();
}
function cacheStatsActive() {
	return cacheStatsActiveFlag;
}
function gapLookbackMs() {
	const configured = useEnv()["CACHE_STATS_GAP_LOOKBACK"];
	return getMilliseconds(configured, DEFAULT_GAP_LOOKBACK);
}
function retentionMs() {
	return getMilliseconds(useEnv()["CACHE_STATS_RETENTION"], DEFAULT_RETENTION);
}
/**
* Clamp a caller-requested listing window (how far back entries + anomalies are
* shown) to [1m, retention]: the admin can't ask for less than a minute, nor for
* data already reaped past the retention cutoff. Undefined falls back to 24h.
*/
function clampCacheStatsWindow(requested) {
	if (requested === void 0 || !Number.isFinite(requested)) return DEFAULT_CACHE_STATS_WINDOW;
	return Math.min(Math.max(requested, MIN_CACHE_STATS_WINDOW), Math.max(retentionMs(), MIN_CACHE_STATS_WINDOW));
}
/**
* Re-read the runtime override into the in-process flag. Called on a short
* per-instance interval so a toggle/autokill anywhere propagates within a tick.
*/
async function refreshCacheStatsFlag() {
	if (!cacheStatsConfigured()) {
		cacheStatsActiveFlag = false;
		return;
	}
	const override = await useRedis().get(flagKey());
	cacheStatsActiveFlag = override === null ? true : override === "1";
}
const CACHE_EVENT_BUFFER_CAP = 1e3;
let cacheEventBuffer = [];
let cacheEventBufferFlushScheduled = false;
let cacheEventBufferFlushInProgress = false;
let cacheEventBufferDropped = 0;
function xadd(fields) {
	if (cacheEventBufferFlushInProgress && cacheEventBuffer.length >= CACHE_EVENT_BUFFER_CAP) {
		cacheEventBufferDropped += 1;
		return;
	}
	const flat = [];
	for (const [field, value] of Object.entries(fields)) flat.push(field, value);
	cacheEventBuffer.push(flat);
	if (cacheEventBuffer.length >= CACHE_EVENT_BUFFER_CAP) flushCacheEventBuffer();
	else if (!cacheEventBufferFlushScheduled) {
		cacheEventBufferFlushScheduled = true;
		setImmediate(() => void flushCacheEventBuffer());
	}
}
async function flushCacheEventBuffer() {
	if (cacheEventBufferFlushInProgress) return;
	cacheEventBufferFlushScheduled = false;
	if (cacheEventBuffer.length === 0) return;
	cacheEventBufferFlushInProgress = true;
	const batch = cacheEventBuffer;
	cacheEventBuffer = [];
	const pipe = useRedis().pipeline();
	const cap = Number(useEnv()["CACHE_STATS_MAX_BUFFER"]) || DEFAULT_STREAM_CAP;
	for (const flat of batch) pipe.call("XADD", streamKey(), "MAXLEN", "~", String(cap), "*", ...flat);
	try {
		await pipe.exec();
	} catch (err) {
		useLogger().warn(err, `[cache-stats] XADD flush failed. ${err.message}`);
	} finally {
		cacheEventBufferFlushInProgress = false;
		if (cacheEventBuffer.length > 0) setImmediate(() => void flushCacheEventBuffer());
	}
}
async function queueCacheHit(hit) {
	if (!cacheStatsActiveFlag) return;
	xadd({
		kind: "h",
		cacheKey: hit.cacheKey,
		ageMs: String(hit.ageMs),
		ttlMs: hit.ttlMs === null ? "" : String(hit.ttlMs),
		durationMs: hit.durationMs === null ? "" : String(hit.durationMs),
		ts: String(Date.now())
	});
}
function queueMissLatency(durationMs, disposition, cacheKey = "") {
	if (!cacheStatsActiveFlag) return;
	xadd({
		kind: MISS_LATENCY_KIND[disposition],
		cacheKey,
		durationMs: String(durationMs),
		ts: String(Date.now())
	});
}
async function queueCacheMiss(miss) {
	if (!cacheStatsActiveFlag) return;
	xadd({
		kind: "m",
		cacheKey: miss.cacheKey,
		gapMs: miss.gapMs === null ? "" : String(miss.gapMs),
		ttlMs: miss.ttlMs === null ? "" : String(miss.ttlMs),
		ts: String(Date.now())
	});
}
async function claimCacheAnomalyThrottleSlot(reason, cacheKey) {
	if (!cacheStatsActiveFlag) return false;
	return await useRedis().set(anomalyThrottleKey(reason, cacheKey), "1", "PX", ANOMALY_THROTTLE_MS, "NX") !== null;
}
function queueCacheAnomaly(entry) {
	if (!cacheStatsActiveFlag) return;
	xadd({
		kind: "a",
		cacheKey: entry.cacheKey,
		reason: entry.reason,
		detail: entry.detail ?? "",
		ts: String(Date.now())
	});
}
/**
* Emit one purge operation — not one event per evicted key, which would put the
* write path's fan-out onto the stream. A purge fires once per mutation, so this
* is mutation-rate, and each row carries how far it reached and what it took.
*/
function queueCachePurge(entry) {
	if (!cacheStatsConfigured()) return;
	xadd({
		kind: "p",
		collection: entry.collection ?? "",
		mode: entry.mode,
		purgeId: entry.purgeId ?? randomUUID(),
		scopedCacheTags: (entry.scopedCacheTags ?? []).join(","),
		scopedCacheTagCount: String(entry.scopedCacheTagCount),
		evicted: entry.evicted === null ? "" : String(entry.evicted),
		durationMs: String(entry.durationMs),
		ts: String(Date.now())
	});
}
async function queueCacheDescriptor(entry) {
	if (!cacheStatsActiveFlag) return;
	xadd({
		kind: "d",
		cacheKey: entry.cacheKey,
		redisKey: entry.redisKey,
		coarse: entry.coarse ? "1" : "0",
		method: entry.method,
		path: entry.path,
		collection: entry.collection ?? "",
		userId: entry.userId ?? "",
		query: entry.query,
		bytes: String(entry.bytes),
		fillMs: String(entry.fillMs),
		scopedCacheTags: entry.scopedCacheTags.join(","),
		ts: entry.lastFilled === null ? "" : String(Date.now())
	});
}
/**
* Drop a tombstone that outlives the cached entry: a re-request arriving after
* the value expired can still read `expiredAt` and see how far past it came.
*
* TTL = the entry's remaining life + the gap lookback, so the tombstone lives
* until `expiry + lookback`. Keying only off the lookback (measured from fill)
* would kill it before a long-TTL entry even expires — losing the lengthen
* signal for exactly the entries the recommendation targets.
*/
async function writeCacheTombstone(redisKey, expiredAt) {
	if (!cacheStatsActiveFlag) return;
	const remainingLifeMs = Math.max(expiredAt - Date.now(), 0);
	await useRedis().set(tombstoneKey(redisKey), String(expiredAt), "PX", Math.max(remainingLifeMs + gapLookbackMs(), 1));
}
async function readCacheMissGap(redisKey, now) {
	const stored = await useRedis().get(tombstoneKey(redisKey));
	if (stored === null) return null;
	return Math.max(now - Number(stored), 0);
}
async function readCacheTombstone(redisKey) {
	if (!redisConfigAvailable()) return null;
	const stored = await useRedis().get(tombstoneKey(redisKey));
	return stored === null ? null : Number(stored);
}
/**
* The collection a display-form scoped cache tag belongs to: `articles`, or the
* head of `articles:owner=7`. Taken off the tag rather than off the descriptor,
* since one entry can read across collections and carry a tag from each.
*/
function collectionOfScopedCacheTag(scopedCacheTag) {
	const slice = scopedCacheTag.indexOf(":");
	return slice === -1 ? scopedCacheTag : scopedCacheTag.slice(0, slice);
}
function parseFields(flat) {
	const fields = {};
	for (let i = 0; i < flat.length; i += 2) fields[flat[i]] = flat[i + 1];
	return fields;
}
function num(value) {
	return value === void 0 || value === "" ? null : Number(value);
}
function dbPoolSaturated(db) {
	return (db.client.pool?.numPendingAcquires?.() ?? 0) > 0;
}
/**
* Guarded entrypoint for the drain. A process-local latch makes an overlapping
* tick on the same node a no-op; cross-node overlap is safe because the drain
* reads through a shared consumer group (each entry to one consumer), not XRANGE.
*/
async function drainCacheEvents() {
	if (!cacheStatsConfigured() || cacheEventDrainInProgress) return 0;
	cacheEventDrainInProgress = true;
	try {
		return await drainCacheEventStream();
	} finally {
		cacheEventDrainInProgress = false;
	}
}
async function drainCacheEventStream() {
	const db = database_default();
	if (dbPoolSaturated(db)) return 0;
	const redis = useRedis();
	await ensureStreamGroup(redis);
	let drained = await reclaimStalePending(redis, db);
	for (;;) {
		if (dbPoolSaturated(db)) break;
		const batch = (await redis.call("XREADGROUP", "GROUP", STREAM_GROUP, CONSUMER_NAME, "COUNT", String(FLUSH_BATCH), "STREAMS", streamKey(), ">"))?.[0]?.[1] ?? [];
		if (batch.length === 0) break;
		await persistStreamBatch(redis, db, batch);
		drained += batch.length;
		if (batch.length < FLUSH_BATCH) break;
	}
	return drained;
}
async function ensureStreamGroup(redis) {
	try {
		await redis.call("XGROUP", "CREATE", streamKey(), STREAM_GROUP, "0", "MKSTREAM");
	} catch (err) {
		if (!String(err?.message).includes("BUSYGROUP")) throw err;
	}
}
async function reclaimStalePending(redis, db) {
	let reclaimed = 0;
	let cursor = "0-0";
	for (;;) {
		if (dbPoolSaturated(db)) break;
		const [nextCursor, batch] = await redis.call("XAUTOCLAIM", streamKey(), STREAM_GROUP, CONSUMER_NAME, String(PENDING_RECLAIM_AFTER), cursor, "COUNT", String(FLUSH_BATCH));
		if (batch.length > 0) {
			await persistStreamBatch(redis, db, batch);
			reclaimed += batch.length;
		}
		if (nextCursor === "0-0") break;
		cursor = nextCursor;
	}
	return reclaimed;
}
async function persistStreamBatch(redis, db, batch) {
	const ids = batch.map(([id]) => id);
	const events = [];
	const descriptors = /* @__PURE__ */ new Map();
	const locators = /* @__PURE__ */ new Map();
	const anomalies = [];
	const purges = [];
	const purgedScopedCacheTags = [];
	const entryScopedCacheTags = /* @__PURE__ */ new Map();
	for (const [, flat] of batch) {
		const f = parseFields(flat);
		const at = new Date(Number(f["ts"]));
		if (f["kind"] === "p") {
			purges.push({
				time: at,
				collection: f["collection"] ? f["collection"] : null,
				purge_id: f["purgeId"] ?? "",
				mode: f["mode"] ?? "slices",
				scoped_cache_tag_count: Number(f["scopedCacheTagCount"] ?? 0),
				evicted: f["evicted"] ? Number(f["evicted"]) : null,
				duration_ms: f["durationMs"] ? Number(f["durationMs"]) : null
			});
			for (const scopedCacheTag of (f["scopedCacheTags"] ?? "").split(",").filter(Boolean)) purgedScopedCacheTags.push({
				purge_id: f["purgeId"] ?? "",
				time: at,
				scoped_cache_tag: printableScopedCacheTags(scopedCacheTag),
				collection: collectionOfScopedCacheTag(scopedCacheTag)
			});
			if (f["mode"] === "collection" && f["collection"]) purgedScopedCacheTags.push({
				purge_id: f["purgeId"] ?? "",
				time: at,
				scoped_cache_tag: "",
				collection: f["collection"]
			});
			continue;
		}
		if (f["kind"] === "a") {
			anomalies.push({
				time: at,
				cache_key: f["cacheKey"],
				reason: f["reason"] ?? "",
				detail: f["detail"] ?? ""
			});
			continue;
		}
		if (f["kind"] === "d") {
			const row = {
				cache_key: f["cacheKey"],
				redis_key: f["redisKey"] ?? "",
				coarse: f["coarse"] === "1",
				method: f["method"] ?? "",
				path: f["path"] ?? "",
				collection: f["collection"] ? f["collection"] : null,
				user_id: f["userId"] ? f["userId"] : null,
				query: f["query"] ?? "",
				bytes: Number(f["bytes"] ?? 0),
				fill_ms: Number(f["fillMs"] ?? 0),
				last_filled: f["ts"] ? at : null
			};
			(row.last_filled === null ? locators : descriptors).set(row.cache_key, row);
			if (row.last_filled !== null) {
				const filledUnder = [...new Set((f["scopedCacheTags"] ?? "").split(",").filter(Boolean))];
				entryScopedCacheTags.set(row.cache_key, filledUnder.map((scopedCacheTag) => {
					return {
						scoped_cache_tag: printableScopedCacheTags(scopedCacheTag),
						collection: collectionOfScopedCacheTag(scopedCacheTag)
					};
				}));
			}
			continue;
		}
		events.push({
			time: at,
			cache_key: f["cacheKey"],
			kind: EVENT_KIND_CODE[f["kind"]] ?? 1,
			age_ms: num(f["ageMs"]),
			gap_ms: num(f["gapMs"]),
			ttl_ms: num(f["ttlMs"]),
			duration_ms: num(f["durationMs"])
		});
	}
	try {
		await db.transaction(async (trx) => {
			if (events.length > 0) await trx.batchInsert("directus_cache_stats_events", events, FLUSH_BATCH);
			if (descriptors.size > 0) await trx("directus_cache_stats_descriptors").insert([...descriptors.values()]).onConflict("cache_key").merge();
			if (locators.size > 0) await trx("directus_cache_stats_descriptors").insert([...locators.values()]).onConflict("cache_key").ignore();
			if (anomalies.length > 0) await trx.batchInsert("directus_cache_stats_anomalies", anomalies, FLUSH_BATCH);
			if (purges.length > 0) await trx.batchInsert("directus_cache_stats_purges", purges, FLUSH_BATCH);
			if (purgedScopedCacheTags.length > 0) await trx.batchInsert("directus_cache_stats_scoped_purge_tags", purgedScopedCacheTags, FLUSH_BATCH);
			if (entryScopedCacheTags.size > 0) {
				await trx("directus_cache_stats_scoped_entry_tags").whereIn("cache_key", [...entryScopedCacheTags.keys()]).delete();
				const rows = [...entryScopedCacheTags].flatMap(([cacheKey, filledUnder]) => {
					return filledUnder.map((tagged) => {
						return {
							cache_key: cacheKey,
							...tagged
						};
					});
				});
				if (rows.length > 0) await trx.batchInsert("directus_cache_stats_scoped_entry_tags", rows, FLUSH_BATCH);
			}
		});
	} catch (err) {
		useLogger().warn(err, `[cache-stats] dropped ${batch.length} unpersistable events. ${err.message}`);
	}
	await redis.call("XACK", streamKey(), STREAM_GROUP, ...ids);
	await redis.call("XDEL", streamKey(), ...ids);
}
/** How far a purge reached, which decides what it can be matched against. */
const SCOPED_CACHE_PURGE_REACHES = ["tag", "collection"];
/**
* The join that answers "did this purge cover that entry", as a builder the
* caller projects. One reach per call, because the two are asked in turn.
*
*  - `tag` — the purge named a tag the entry was filled under.
*  - `collection` — the purge named no tag at all (the coarse fallback dropped
*    the bare tag AND every slice, so no single tag states its reach), and a
*    pinned entry carries only its slice tag, so the tag reach never sees it.
*
* Shared rather than written per caller because it is the join CONDITION the two
* readers must agree on: a count saying an entry was purged, beside a listing
* that cannot name the purge, would be reporting different things.
*/
function scopedCachePurgeCoverage(db, reach, cacheKeys, since) {
	if (reach === "tag") return db("directus_cache_stats_scoped_entry_tags as et").join("directus_cache_stats_scoped_purge_tags as pt", "pt.scoped_cache_tag", "et.scoped_cache_tag").where("pt.time", ">", since).whereIn("et.cache_key", cacheKeys);
	return db("directus_cache_stats_scoped_purge_tags as pt").join("directus_cache_stats_scoped_entry_tags as et", "et.collection", "pt.collection").where("pt.time", ">", since).where("pt.scoped_cache_tag", "").whereIn("et.cache_key", cacheKeys);
}
/**
* The purges that covered one entry since `since` — pass its `last_filled` and
* the answer is what happened to it after it was written. Read beside `exists`:
* a purge covering an entry that is still held is a missed invalidation, which
* is the question the cached payload used to be eyeballed for.
*
* Ordered newest first and capped, because an entry pinned to a hot slice can
* be covered by thousands of purges and the first few answer the question.
*/
async function listPurgesCoveringEntry(cacheKey, since) {
	if (!cacheStatsConfigured()) return [];
	const db = database_default();
	const rows = [];
	for (const reach of SCOPED_CACHE_PURGE_REACHES) rows.push(...await scopedCachePurgeCoverage(db, reach, [cacheKey], since).join("directus_cache_stats_purges as p", "p.purge_id", "pt.purge_id").distinct("p.purge_id", "p.time", "p.mode", "p.collection", "pt.scoped_cache_tag", "p.evicted").orderBy("p.time", "desc").orderBy("pt.scoped_cache_tag", "asc").limit(CACHE_ENTRY_PURGE_LIMIT));
	rows.push(...await db("directus_cache_stats_purges as p").where("p.mode", "namespace").where("p.time", ">", since).select("p.purge_id", "p.time", "p.mode", "p.collection", "p.evicted").orderBy("p.time", "desc").limit(CACHE_ENTRY_PURGE_LIMIT));
	const byPurgeId = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const purgeId = row["purge_id"];
		if (byPurgeId.has(purgeId)) continue;
		byPurgeId.set(purgeId, {
			time: new Date(row["time"]).getTime(),
			mode: row["mode"],
			collection: row["collection"] ?? null,
			scopedCacheTag: row["scoped_cache_tag"] || null,
			evicted: row["evicted"] === null ? null : Number(row["evicted"])
		});
	}
	return [...byPurgeId.values()].sort((a, b) => b.time - a.time).slice(0, CACHE_ENTRY_PURGE_LIMIT);
}
/**
* The descriptor behind a Redis key.
*
* `cache_key` is tried first and answers on any install that hashes, where both
* columns hold the same digest and that one is the primary key. Only a readable
* key (`CACHE_KEY_HASH_ENABLED=false`) falls through to `redis_key`, which is
* TEXT — unindexed, since MySQL cannot index it without a prefix length, and the
* scan is paid once per inspection rather than on any hot path.
*
* The primary-key arm goes first for a second reason: `redis_key` defaults to
* `''` on rows written before it existed and on anomaly locators, so an empty
* probe would match all of them at once.
*
* A locator answers null like a key with no descriptor at all: `last_filled` is
* nullable exactly so that a descriptor written at an anomaly site can say the
* response was never cached, and there is no fill to measure anything from. The
* entries listing draws the same line with `WHERE last_filled IS NOT NULL`.
*/
async function readCacheDescriptorForRedisKey(redisKey) {
	if (!cacheStatsConfigured() || redisKey === "") return null;
	const db = database_default();
	const found = await db("directus_cache_stats_descriptors").where("cache_key", redisKey).first("cache_key", "last_filled") ?? await db("directus_cache_stats_descriptors").where("redis_key", redisKey).first("cache_key", "last_filled");
	if (found === void 0 || found["last_filled"] === null) return null;
	return {
		cacheKey: found["cache_key"],
		lastFilled: new Date(found["last_filled"])
	};
}
/**
* The URL a descriptor no longer stores. A GET's is its path plus the query
* string it carried, which is why `query` holds that string verbatim; a GraphQL
* read has none, its document travelling in a POST body.
*/
function descriptorUrl(path, query) {
	if (path.startsWith("/graphql")) return "";
	if (query === "" || query.startsWith("{")) return path;
	return `${path}?${query}`;
}
/**
* Recent cache activity for the admin page: windowed hits (fact) ranked on
* their own, then paired with the descriptor (dimension, survives retention).
* Not a live view — an entry evicted or expired inside the window still shows
* until its events age out.
*/
async function listCacheEntries(windowMs) {
	if (!cacheStatsConfigured()) return [];
	const db = database_default();
	const since = new Date(Date.now() - clampCacheStatsWindow(windowMs ?? DEFAULT_CACHE_ENTRIES_WINDOW));
	const eventAggregateSelects = [
		"e.cache_key",
		db.raw("SUM(CASE WHEN e.kind = 0 THEN 1 ELSE 0 END) AS hits"),
		db.raw("SUM(CASE WHEN e.kind = 1 THEN 1 ELSE 0 END) AS misses"),
		db.raw("SUM(CASE WHEN e.kind = 2 THEN 1 ELSE 0 END) AS fills"),
		db.raw("MAX(CASE WHEN e.kind = 0 THEN e.time END) AS last_hit_at"),
		db.raw("MAX(e.ttl_ms) AS ttl_ms"),
		db.raw("AVG(CASE WHEN e.kind = 0 THEN e.duration_ms END) AS hit_ms")
	];
	if (db.client.config.client === "pg") eventAggregateSelects.push(db.raw("percentile_cont(0.95) WITHIN GROUP (ORDER BY CASE WHEN e.kind = 0 THEN e.age_ms ELSE e.ttl_ms + e.gap_ms END) FILTER (WHERE e.kind = 0 OR e.gap_ms IS NOT NULL) AS recommended_ttl_ms"));
	const eventAggregateRows = await db("directus_cache_stats_events as e").where("e.time", ">", since).whereExists((filledDescriptor) => {
		filledDescriptor.select(db.raw("1")).from("directus_cache_stats_descriptors as d").whereRaw("?? = ??", ["d.cache_key", "e.cache_key"]).whereNotNull("d.last_filled");
	}).groupBy("e.cache_key").orderBy("hits", "desc").orderBy("e.cache_key", "asc").limit(CACHE_STATS_LISTING_LIMIT).select(eventAggregateSelects);
	const listedKeys = eventAggregateRows.map((row) => {
		return String(row["cache_key"]);
	});
	const descriptorRows = listedKeys.length === 0 ? [] : await db("directus_cache_stats_descriptors as d").leftJoin("directus_users as u", "u.id", "d.user_id").whereIn("d.cache_key", listedKeys).select("d.cache_key", "d.redis_key", "d.coarse", "d.method", "d.path", "d.collection", "d.user_id", "u.email as user_email", "d.query", "d.bytes", "d.fill_ms", "d.last_filled");
	const descriptorsByKey = new Map(descriptorRows.map((row) => {
		return [String(row["cache_key"]), row];
	}));
	const rows = eventAggregateRows.flatMap((row) => {
		const descriptor = descriptorsByKey.get(String(row["cache_key"]));
		return descriptor === void 0 ? [] : [{
			...descriptor,
			...row
		}];
	});
	const purgesByKey = /* @__PURE__ */ new Map();
	if (listedKeys.length > 0) for (const reach of SCOPED_CACHE_PURGE_REACHES) {
		const counted = await scopedCachePurgeCoverage(db, reach, listedKeys, since).groupBy("et.cache_key").select("et.cache_key", db.raw("COUNT(DISTINCT pt.purge_id) AS purges"));
		for (const row of counted) {
			const cacheKey = row["cache_key"];
			const already = purgesByKey.get(cacheKey) ?? 0;
			purgesByKey.set(cacheKey, already + Number(row["purges"] ?? 0));
		}
	}
	return rows.map((row) => {
		const createdAt = new Date(row["last_filled"]).getTime();
		const ttlMs = row["ttl_ms"] === null ? null : Number(row["ttl_ms"]);
		const lastHit = row["last_hit_at"];
		const userId = row["user_id"] || null;
		return {
			key: row["cache_key"],
			purges: purgesByKey.get(row["cache_key"]) ?? 0,
			redisKey: row["redis_key"],
			coarse: Boolean(row["coarse"]),
			method: row["method"],
			path: row["path"],
			collection: row["collection"] || null,
			user: userId === null ? null : {
				id: userId,
				email: row["user_email"] ?? null
			},
			query: row["query"] ?? "",
			url: descriptorUrl(row["path"], row["query"] ?? ""),
			size: Number(row["bytes"] ?? 0),
			hits: Number(row["hits"] ?? 0),
			misses: Number(row["misses"] ?? 0),
			fills: Number(row["fills"] ?? 0),
			fillMs: row["fill_ms"] === null ? null : Number(row["fill_ms"]),
			hitMs: row["hit_ms"] === null || row["hit_ms"] === void 0 ? null : Math.round(Number(row["hit_ms"])),
			ttlMs,
			recommendedTtlMs: row["recommended_ttl_ms"] == null ? null : Math.round(Number(row["recommended_ttl_ms"])),
			createdAt,
			expiresAt: ttlMs === null ? null : createdAt + ttlMs,
			lastHitAt: lastHit ? new Date(lastHit).getTime() : null
		};
	});
}
/**
* Response-latency percentiles per tree node, for ranking endpoints by what a
* cache miss actually costs.
*
* - Two grouping sets in one pass: `(path, method, query)` matches the query
*   nodes of the page's tree, `(path)` the endpoint nodes above them.
* - Each set aggregates the raw events, so an endpoint's p95 is the p95 of its
*   own requests — not a rollup of its children's percentiles, which would not
*   be a percentile at all.
* - One entry per metric the timeseries chart also draws, over the same kinds:
*   `response` pools everything timed, `miss` the compute kinds 2/3/4, `anomaly`
*   and `fill` the flagged and cached slices of those, `hit` a serve straight
*   from cache.
* - `percentile_cont` is an ordered-set aggregate: Postgres only, like
*   `recommendedTtlMs`. Other dialects get an empty list and the tree drops the
*   percentile columns.
*/
async function listCacheGroupLatencies(windowMs) {
	const db = database_default();
	if (!cacheStatsConfigured() || db.client.config.client !== "pg") return [];
	const since = new Date(Date.now() - clampCacheStatsWindow(windowMs ?? DEFAULT_CACHE_LATENCIES_WINDOW));
	const pct = (p, filter) => {
		return `percentile_cont(${p}) WITHIN GROUP (ORDER BY e.duration_ms) FILTER (WHERE ${filter})`;
	};
	const metricKinds = {
		response: "e.kind IN (0, 2, 3, 4)",
		miss: "e.kind IN (2, 3, 4)",
		anomaly: "e.kind = 3",
		fill: "e.kind = 2",
		hit: "e.kind = 0"
	};
	const percentileSelects = CACHE_LATENCY_METRICS.flatMap((metric) => {
		return [
			.5,
			.95,
			.99
		].map((quantile) => {
			const column = `${metric}_p${Math.round(quantile * 100)}`;
			return db.raw(`${pct(quantile, metricKinds[metric])} AS ${column}`);
		});
	});
	const rows = await db("directus_cache_stats_descriptors as d").join("directus_cache_stats_events as e", "e.cache_key", "d.cache_key").where("e.time", ">", since).whereIn("e.kind", [
		0,
		2,
		3,
		4
	]).whereNotNull("e.duration_ms").whereNotNull("d.last_filled").groupByRaw("GROUPING SETS ((d.path, d.method, d.query), (d.path))").select("d.path", db.raw("GROUPING(d.method) AS method_rolled_up"), "d.method", "d.query", ...percentileSelects);
	function metricPercentiles(row, metric) {
		function millis(column) {
			const value = row[`${metric}_${column}`];
			return value == null ? null : Math.round(Number(value));
		}
		return {
			p50: millis("p50"),
			p95: millis("p95"),
			p99: millis("p99")
		};
	}
	return rows.map((row) => {
		const rolledUp = Number(row["method_rolled_up"]) === 1;
		return {
			path: row["path"],
			method: rolledUp ? null : row["method"],
			query: rolledUp ? null : row["query"] ?? "",
			response: metricPercentiles(row, "response"),
			miss: metricPercentiles(row, "miss"),
			anomaly: metricPercentiles(row, "anomaly"),
			fill: metricPercentiles(row, "fill"),
			hit: metricPercentiles(row, "hit")
		};
	});
}
/**
* Evict a single cached response: the value + its `__expires_at`/`__tags`
* siblings. Best-effort — a no-op if it already expired. The descriptor lingers
* until the reaper prunes it.
*/
async function evictCacheEntry(cache, redisKey) {
	await cache.delete(redisKey);
	await cache.delete(`${redisKey}__expires_at`);
	await cache.delete(`${redisKey}__tags`);
}
async function evictCacheEntriesForPath(cache, path) {
	if (!cacheStatsConfigured()) return 0;
	const keys = await database_default()("directus_cache_stats_descriptors").where({ path }).pluck("redis_key");
	await Promise.all(keys.map((key) => evictCacheEntry(cache, key)));
	return keys.length;
}
/**
* Nothing in `referencingTable` points at this dimension row's key.
*
* `NOT EXISTS` rather than the `NOT IN (SELECT DISTINCT …)` it replaces: the
* anti-join stops at the first matching row per key instead of hashing every
* distinct key of a fact table into `work_mem`, which is what made the sweep
* too expensive to run more often than daily.
*/
function whereUnreferencedBy(query, referencingTable, dimensionTable) {
	const db = database_default();
	query.whereNotExists((referencing) => {
		referencing.select(db.raw("1")).from(referencingTable).whereRaw("??.cache_key = ??.cache_key", [referencingTable, dimensionTable]);
	});
}
/**
* Delete a bounded slate of orphan rows from a dimension table.
*
* - `scopeToOrphans` adds the table's own orphan rule to a SELECT; the keys it
*   returns are then named in the DELETE, so no dialect has to support a LIMIT
*   inside an IN subquery (MariaDB does not).
* - Bounded because these run on a short cadence: a pass costs the same whether
*   the table holds a thousand orphans or a million, and the next tick takes the
*   rest. A short slate means the table is clean, so the loop stops there.
*/
async function reapDimensionOrphans(dimensionTable, scopeToOrphans, narrowSlate) {
	const db = database_default();
	let reaped = 0;
	for (let pass = 0; pass < DIMENSION_REAP_PASSES; pass += 1) {
		const slate = db(dimensionTable).select("cache_key").limit(DIMENSION_REAP_BATCH);
		scopeToOrphans(slate);
		const rows = await slate;
		if (rows.length === 0) return reaped;
		const keys = [...new Set(narrowSlate ? await narrowSlate(rows) : rows.map((row) => row["cache_key"]))];
		if (keys.length > 0) reaped += await db(dimensionTable).whereIn("cache_key", keys).delete();
		if (rows.length < DIMENSION_REAP_BATCH) return reaped;
	}
	return reaped;
}
/**
* The slate's keys whose cached entry is gone, which is what makes a descriptor
* an orphan: it describes one entry, and it has nothing left to describe once
* that entry is out of the cache.
*
* - `hasMany` is one round-trip of EXISTS for the whole slate and never
*   transfers a value, so a slate of descriptors costs about what a single get
*   would.
* - Keyv owns the key prefixing and this does not rebuild it. The raw key is
*   namespaced twice over — `<ns>_response::<ns>_response:<key>` on the
*   deployment this was checked against — because the store prefixes what Keyv
*   already prefixed, and a version bump moving that would silently turn every
*   descriptor into an orphan.
* - No cache at all (memory store off, Redis down) ⇒ nothing is live, which is
*   the same answer the reaper's other two rules already give.
*/
async function cacheKeysWithNoLiveEntry(rows) {
	const { getCache } = await import("./cache.js");
	const { cache } = getCache();
	if (!cache) return rows.map((row) => row["cache_key"]);
	const live = await cache.hasMany(rows.map((row) => row["redis_key"] ?? ""));
	return rows.filter((_row, index) => live[index] !== true).map((row) => row["cache_key"]);
}
/**
* Prune descriptor rows that describe nothing any more: their cached entry is
* gone AND no event or anomaly still names the key. Orphans left by a Directus
* upgrade (new key generation) or a query combo that went quiet. Reproduces the
* old Redis sidecar's TTL self-cleanup, which the dimension lacks.
*
* There is no age window in that rule, and there was one — ninety days from the
* last fill. A window is a guess at when a descriptor stops being useful, and
* the entry it describes answers that exactly.
*/
async function reapCacheDescriptors() {
	if (!cacheStatsConfigured()) return 0;
	const dimensionTable = "directus_cache_stats_descriptors";
	return reapDimensionOrphans(dimensionTable, (query) => {
		query.select("redis_key");
		whereUnreferencedBy(query, "directus_cache_stats_events", dimensionTable);
		whereUnreferencedBy(query, "directus_cache_stats_anomalies", dimensionTable);
	}, cacheKeysWithNoLiveEntry);
}
/**
* Prune fact rows past the retention window. The cross-dialect bound on
* `directus_cache_stats_events` growth: Timescale's own retention policy only
* covers the hypertable path, so plain PG / MySQL / SQLite rely on this daily
* sweep (and it's a harmless belt on Timescale, where chunk-drop already
* reclaims older rows).
*/
async function reapCacheEvents() {
	if (!cacheStatsConfigured()) return 0;
	const cutoff = new Date(Date.now() - retentionMs());
	return database_default()("directus_cache_stats_events").where("time", "<", cutoff).delete();
}
/**
* Prune purge-tag rows past the retention window, alongside the purges they
* belong to — the join half ages out with the fact half or it would outlive it
* and keep claiming coverage for purges nothing remembers.
*/
async function reapScopedCachePurgeTags() {
	if (!cacheStatsConfigured()) return 0;
	const cutoff = new Date(Date.now() - retentionMs());
	return database_default()("directus_cache_stats_scoped_purge_tags").where("time", "<", cutoff).delete();
}
/**
* Drop tag rows whose entry no longer has a descriptor. The tags are a dimension
* of the entry, so they follow it out rather than accumulating for keys that
* stopped appearing.
*/
async function reapScopedCacheEntryTags() {
	if (!cacheStatsConfigured()) return 0;
	const dimensionTable = "directus_cache_stats_scoped_entry_tags";
	return reapDimensionOrphans(dimensionTable, (query) => {
		whereUnreferencedBy(query, "directus_cache_stats_descriptors", dimensionTable);
	});
}
/**
* Prune purge rows past the retention window. Bounded like every other fact
* table here: a purge row is written per mutation, so an unswept table grows
* with the write workload rather than with the cache.
*/
async function reapCachePurges() {
	if (!cacheStatsConfigured()) return 0;
	const cutoff = new Date(Date.now() - retentionMs());
	return database_default()("directus_cache_stats_purges").where("time", "<", cutoff).delete();
}
/**
* Recent cache anomalies for the admin page, grouped by cache_key+reason and shown
* under each path/method/query node, with an occurrence count. Windowed like the
* entries listing; older rows are reaped.
*/
async function listCacheAnomalies(windowMs) {
	if (!cacheStatsConfigured()) return [];
	const db = database_default();
	const since = new Date(Date.now() - clampCacheStatsWindow(windowMs));
	return (await db("directus_cache_stats_anomalies as a").join("directus_cache_stats_descriptors as d", "d.cache_key", "a.cache_key").where("a.time", ">", since).groupBy("a.cache_key", "a.reason", "d.path", "d.method", "d.query").select("a.cache_key", "a.reason", "d.path", "d.method", "d.query", db.raw("COUNT(*) AS count"), db.raw("MAX(a.detail) AS sample"), db.raw("MAX(a.time) AS last_seen")).orderBy("count", "desc").orderBy("a.cache_key", "asc").orderBy("a.reason", "asc").limit(CACHE_STATS_LISTING_LIMIT)).map((row) => {
		return {
			cacheKey: row["cache_key"],
			reason: row["reason"],
			path: row["path"],
			method: row["method"],
			query: row["query"] ?? "",
			url: descriptorUrl(row["path"], row["query"] ?? ""),
			count: Number(row["count"] ?? 0),
			sample: row["sample"] || null,
			lastSeen: new Date(row["last_seen"]).getTime()
		};
	});
}
async function reapCacheAnomalies() {
	if (!cacheStatsConfigured()) return 0;
	const cutoff = new Date(Date.now() - retentionMs());
	return database_default()("directus_cache_stats_anomalies").where("time", "<", cutoff).delete();
}
/**
* The range a requested bucket count has to fall in. Exported so that the schema
* publishing the argument, the guard refusing it and the clamp below all name
* one bound rather than three that can drift.
*/
const CACHE_TIMESERIES_MIN_BUCKETS = 1;
const CACHE_TIMESERIES_MAX_BUCKETS = 500;
/**
* Append a marker for an admin cache action (a TTL change, a flush) so the cache
* page can plot it over the timeseries. Recorded unconditionally — NOT gated on
* cache-stats — so a change made while stats were off still shows once they return.
* `detail` carries the new TTL value (`ttl_change`) or the joined targets (`flush`).
*/
async function recordCacheConfigEvent(kind, detail) {
	await database_default()("directus_cache_stats_config_events").insert({
		time: /* @__PURE__ */ new Date(),
		kind,
		detail
	});
}
/**
* A `ttl_change` marker's value in ms. `null` detail is a CLEARED override, which
* hands the TTL back to env `CACHE_TTL` — so it resolves to the env value, not to
* "unknown".
*
* That env value is read NOW, not as of the marker: a clear recorded while
* `CACHE_TTL` was `5m`, replayed after a deploy moved it to `1h`, draws `1h` over a
* period that ran at `5m`. Closing that would mean recording the resolved value in
* `detail` at write time; until then a clear is only as accurate as env is stable.
*/
function markerTtlMs(detail) {
	const env = useEnv();
	return getMilliseconds(detail ?? env["CACHE_TTL"]) ?? null;
}
/**
* The TTL in force over each bucket, replaying the `ttl_change` markers across the
* grid. `seedTtlMs` is what the window opened on — the last change before it, or
* `null` when none is recorded, in which case the leading buckets stay `null` rather
* than inheriting a value from a change that had not happened yet.
*
* A change applies from the bucket that CONTAINS it onward: a bucket is a span, and
* the value that ends it is the one a reader is asking about when the marker sits on
* it. Exported for its own tests — the reconstruction is the whole point of the
* series and is worth pinning without a database.
*/
function effectiveTtlByBucket(bucketTimes, changes, seedTtlMs) {
	const ordered = [...changes].sort((a, b) => a.time - b.time);
	let pending = 0;
	let inForce = seedTtlMs;
	return bucketTimes.map((_bucketTime, index) => {
		const bucketEnd = bucketTimes[index + 1] ?? Infinity;
		while (pending < ordered.length && ordered[pending].time < bucketEnd) {
			inForce = ordered[pending].ttlMs;
			pending++;
		}
		return inForce;
	});
}
/**
* Bucketed hits / misses / anomalies + the effective TTL curve over `windowMs`, plus
* the discrete config-event markers in the same window. The curves come from the
* stats tables (only populated when stats are configured) and the bucketing is
* Postgres-only, like `recommended_ttl`; markers come from their own always-recorded
* table, so they surface even with stats off (over otherwise-empty curves).
*/
async function readCacheTimeseries(windowMs, buckets = 60) {
	const db = database_default();
	const windowLen = clampCacheStatsWindow(windowMs);
	const now = Date.now();
	const bucketCount = Math.min(Math.max(Math.trunc(buckets), CACHE_TIMESERIES_MIN_BUCKETS), CACHE_TIMESERIES_MAX_BUCKETS);
	const bucketSec = Math.max(1, Math.ceil(windowLen / bucketCount / 1e3));
	const bucketMs = bucketSec * 1e3;
	const sinceMs = Math.floor(now / bucketMs) * bucketMs - (bucketCount - 1) * bucketMs;
	const since = new Date(sinceMs);
	const markers = (await db("directus_cache_stats_config_events").where("time", ">", since).orderBy("time", "asc").select("time", "kind", "detail")).map((row) => {
		return {
			time: new Date(row["time"]).getTime(),
			kind: row["kind"],
			detail: row["detail"] ?? null
		};
	});
	const effective = resolvedCacheTtl();
	const effectiveTtl = typeof effective === "string" && effective !== "" ? effective : null;
	const dense = Array.from({ length: bucketCount }, (_unused, index) => {
		return {
			t: sinceMs + index * bucketSec * 1e3,
			hits: 0,
			misses: 0,
			fills: 0,
			anomalies: 0,
			purges: 0,
			coarsePurges: 0,
			purgedEntries: 0,
			purgeP50: null,
			purgeP95: null,
			purgeP99: null,
			ttlMs: null,
			effectiveTtlMs: null,
			hitP50: null,
			hitP95: null,
			hitP99: null,
			fillP50: null,
			fillP95: null,
			fillP99: null,
			anomalyP50: null,
			anomalyP95: null,
			anomalyP99: null,
			missP50: null,
			missP95: null,
			missP99: null,
			bothP50: null,
			bothP95: null,
			bothP99: null
		};
	});
	const priorChange = await db("directus_cache_stats_config_events").where("kind", "ttl_change").andWhere("time", "<=", since).orderBy("time", "desc").first();
	const ttlChanges = markers.filter((marker) => marker.kind === "ttl_change").map((marker) => {
		return {
			time: marker.time,
			ttlMs: markerTtlMs(marker.detail)
		};
	});
	function windowOpenedOn() {
		if (priorChange) return markerTtlMs(priorChange["detail"] ?? null);
		return ttlChanges.length === 0 ? getMilliseconds(effective) ?? null : null;
	}
	const seedTtlMs = windowOpenedOn();
	effectiveTtlByBucket(dense.map((bucket) => bucket.t), ttlChanges, seedTtlMs).forEach((ttlMs, index) => {
		dense[index].effectiveTtlMs = ttlMs;
	});
	if (!cacheStatsConfigured() || db.client.config.client !== "pg") return {
		buckets: dense,
		markers,
		effectiveTtl
	};
	const bucketExpr = "floor(extract(epoch from (time - ?::timestamptz)) / ?)";
	const eventRows = await db("directus_cache_stats_events").where("time", ">", since).groupByRaw("1").select(db.raw(`${bucketExpr} AS bucket`, [since, bucketSec]), db.raw("SUM(CASE WHEN kind = 0 THEN 1 ELSE 0 END) AS hits"), db.raw("SUM(CASE WHEN kind = 1 THEN 1 ELSE 0 END) AS misses"), db.raw("SUM(CASE WHEN kind = 2 THEN 1 ELSE 0 END) AS fills"), db.raw("MAX(ttl_ms) AS ttl_ms"));
	const pct = (p, filter) => {
		const base = `percentile_cont(${p}) WITHIN GROUP (ORDER BY duration_ms)`;
		return filter ? `${base} FILTER (WHERE ${filter})` : base;
	};
	const latencyRows = await db("directus_cache_stats_events").where("time", ">", since).whereIn("kind", [
		0,
		2,
		3,
		4
	]).whereNotNull("duration_ms").groupByRaw("1").select(db.raw(`${bucketExpr} AS bucket`, [since, bucketSec]), db.raw(`${pct(.5, "kind = 0")} AS hit_p50`), db.raw(`${pct(.95, "kind = 0")} AS hit_p95`), db.raw(`${pct(.99, "kind = 0")} AS hit_p99`), db.raw(`${pct(.5, "kind = 2")} AS fill_p50`), db.raw(`${pct(.95, "kind = 2")} AS fill_p95`), db.raw(`${pct(.99, "kind = 2")} AS fill_p99`), db.raw(`${pct(.5, "kind = 3")} AS anomaly_p50`), db.raw(`${pct(.95, "kind = 3")} AS anomaly_p95`), db.raw(`${pct(.99, "kind = 3")} AS anomaly_p99`), db.raw(`${pct(.5, "kind IN (2, 3, 4)")} AS miss_p50`), db.raw(`${pct(.95, "kind IN (2, 3, 4)")} AS miss_p95`), db.raw(`${pct(.99, "kind IN (2, 3, 4)")} AS miss_p99`), db.raw(`${pct(.5)} AS both_p50`), db.raw(`${pct(.95)} AS both_p95`), db.raw(`${pct(.99)} AS both_p99`));
	const anomalyRows = await db("directus_cache_stats_anomalies").where("time", ">", since).groupByRaw("1").select(db.raw(`${bucketExpr} AS bucket`, [since, bucketSec]), db.raw("COUNT(*) AS count"));
	const distinctPurges = db("directus_cache_stats_purges").where("time", ">", since).distinct("purge_id", "time", "mode", "evicted", "duration_ms").as("p");
	const purgeRows = await db(distinctPurges).groupByRaw("1").select(db.raw(`${bucketExpr} AS bucket`, [since, bucketSec]), db.raw("COUNT(*) AS count"), db.raw("SUM(CASE WHEN mode IN ('collection', 'namespace') THEN 1 ELSE 0 END) AS coarse"), db.raw("SUM(evicted) AS evicted"));
	function slotOf(bucket) {
		return Math.min(Math.max(Number(bucket), 0), bucketCount - 1);
	}
	for (const row of eventRows) {
		const index = slotOf(row["bucket"]);
		dense[index].hits += Number(row["hits"] ?? 0);
		dense[index].misses += Number(row["misses"] ?? 0);
		dense[index].fills += Number(row["fills"] ?? 0);
		if (row["ttl_ms"] != null) dense[index].ttlMs = Number(row["ttl_ms"]);
	}
	for (const row of anomalyRows) dense[slotOf(row["bucket"])].anomalies += Number(row["count"] ?? 0);
	for (const row of purgeRows) {
		const index = slotOf(row["bucket"]);
		dense[index].purges += Number(row["count"] ?? 0);
		dense[index].coarsePurges += Number(row["coarse"] ?? 0);
		dense[index].purgedEntries += Number(row["evicted"] ?? 0);
	}
	function pctVal(value) {
		return value == null ? null : Number(value);
	}
	for (const row of latencyRows) {
		const slot = dense[slotOf(row["bucket"])];
		slot.hitP50 = pctVal(row["hit_p50"]);
		slot.hitP95 = pctVal(row["hit_p95"]);
		slot.hitP99 = pctVal(row["hit_p99"]);
		slot.fillP50 = pctVal(row["fill_p50"]);
		slot.fillP95 = pctVal(row["fill_p95"]);
		slot.fillP99 = pctVal(row["fill_p99"]);
		slot.anomalyP50 = pctVal(row["anomaly_p50"]);
		slot.anomalyP95 = pctVal(row["anomaly_p95"]);
		slot.anomalyP99 = pctVal(row["anomaly_p99"]);
		slot.missP50 = pctVal(row["miss_p50"]);
		slot.missP95 = pctVal(row["miss_p95"]);
		slot.missP99 = pctVal(row["miss_p99"]);
		slot.bothP50 = pctVal(row["both_p50"]);
		slot.bothP95 = pctVal(row["both_p95"]);
		slot.bothP99 = pctVal(row["both_p99"]);
	}
	const purgeLatencyRows = await db(distinctPurges).groupByRaw("1").select(db.raw(`${bucketExpr} AS bucket`, [since, bucketSec]), db.raw(`${pct(.5)} AS purge_p50`), db.raw(`${pct(.95)} AS purge_p95`), db.raw(`${pct(.99)} AS purge_p99`));
	for (const row of purgeLatencyRows) {
		const slot = dense[slotOf(row["bucket"])];
		slot.purgeP50 = pctVal(row["purge_p50"]);
		slot.purgeP95 = pctVal(row["purge_p95"]);
		slot.purgeP99 = pctVal(row["purge_p99"]);
	}
	return {
		buckets: dense,
		markers,
		effectiveTtl
	};
}
async function reapCacheConfigEvents() {
	const cutoff = new Date(Date.now() - retentionMs());
	return database_default()("directus_cache_stats_config_events").where("time", "<", cutoff).delete();
}
/**
* Hold the subsystem inside CACHE_STATS_MAX_BYTES by dropping its oldest
* telemetry, so capture never has to stop to make room.
*
* - A chunk drop is the only thing that returns disk here: the row DELETE the
*   reapers do leaves the space behind for the table to reuse. So the ring runs
*   on the facts, which are chunked, and the dimensions are held by their own
*   reaper instead (see reapDimensionOrphans).
* - Which tables those are is this module's business; measuring them and cutting
*   a chunk is the database's, so both go to the dialect helper by name. It has
*   no idea they are cache telemetry, and the budget has no idea what a
*   hypertable is.
* - It runs whether capture is on or off. A subsystem that was disabled still
*   holds every byte it wrote, and the flag is not what the budget is about.
* - Evicting to a low watermark rather than to the line stops the ring cutting
*   one chunk per tick for as long as writes keep it at the boundary.
* - The floor keeps the newest telemetry whatever the budget says: a burst that
*   filled the budget in an hour must not answer by deleting that hour.
*
* Nothing here disables capture any more. When the ring runs out of evictable
* chunks and the subsystem is still over, it says so on the state the admin
* page reads and keeps collecting; an admin toggling it off is the one thing
* that stops it.
*/
async function enforceCacheStatsBudget() {
	const maxBytes = parse(String(useEnv()["CACHE_STATS_MAX_BYTES"] ?? ""));
	const { getHelpers } = await import("./database/helpers/index.js");
	const { schema } = getHelpers(database_default());
	let bytes$1 = maxBytes ? await schema.getTablesSize(CACHE_STATS_TABLES) : null;
	if (bytes$1 === null || bytes$1 <= maxBytes) {
		await clearCacheStatsBudgetAlert();
		return;
	}
	const logger = useLogger();
	const floor = new Date(Date.now() - CACHE_STATS_MIN_RETENTION);
	for (let drop = 0; drop < CACHE_STATS_EVICTIONS_PER_TICK; drop += 1) {
		const dropped = await schema.dropOldestChunk(CACHE_STATS_FACTS, floor);
		if (dropped === null) {
			const alert = `${bytes$1}B over the ${maxBytes}B budget, and every chunk left is newer than the retention floor`;
			logger.warn(`[cache-stats] ${alert}`);
			await useRedis().set(budgetAlertKey(), alert);
			return;
		}
		logger.info(`[cache-stats] evicted ${dropped.table} < ${dropped.upTo.toISOString()} to stay inside budget`);
		bytes$1 = await schema.getTablesSize(CACHE_STATS_TABLES);
		if (bytes$1 === null || bytes$1 <= maxBytes * CACHE_STATS_BUDGET_LOW_WATER) {
			await clearCacheStatsBudgetAlert();
			return;
		}
	}
	await clearCacheStatsBudgetAlert();
}
async function clearCacheStatsBudgetAlert() {
	await useRedis().del(budgetAlertKey());
}
const TOGGLE_CHANNEL = "cacheStatsToggled";
/**
* Re-apply the flag on every node the instant it changes — event-driven via the
* shared bus (same pattern as cache.ts `schemaChanged`), replacing a per-node
* poll. Boot still primes from the Redis key, so a node down for the publish
* catches up on its next start.
*/
function subscribeCacheStatsToggle() {
	if (!redisConfigAvailable()) return;
	useBus().subscribe(TOGGLE_CHANNEL, () => {
		refreshCacheStatsFlag();
	});
}
/**
* Flip the runtime override for every node (bus publish) and this node now. An
* admin is the only caller: nothing in here disables capture on its own, so the
* flag says what a person asked for and nothing else.
*/
async function setCacheStatsEnabled(enabled) {
	await useRedis().set(flagKey(), enabled ? "1" : "0");
	cacheStatsActiveFlag = enabled ? cacheStatsConfigured() : false;
	useBus().publish(TOGGLE_CHANNEL, { enabled });
}
async function getCacheStatsState() {
	if (!cacheStatsConfigured()) return {
		configured: false,
		enabled: false,
		budgetAlert: null,
		bufferLength: 0,
		droppedEvents: cacheEventBufferDropped
	};
	const redis = useRedis();
	return {
		configured: true,
		enabled: cacheStatsActiveFlag,
		budgetAlert: await redis.get(budgetAlertKey()),
		bufferLength: await redis.xlen(streamKey()),
		droppedEvents: cacheEventBufferDropped
	};
}
async function deleteStatsKeysByPattern(redis, pattern) {
	let cursor = "0";
	do {
		const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
		cursor = next;
		if (keys.length > 0) await redis.unlink(...keys);
	} while (cursor !== "0");
}
async function truncateCacheEvents() {
	const db = database_default();
	await db("directus_cache_stats_events").truncate();
	await db("directus_cache_stats_descriptors").truncate();
	await db("directus_cache_stats_anomalies").truncate();
	await db("directus_cache_stats_purges").truncate();
	await db("directus_cache_stats_scoped_purge_tags").truncate();
	await db("directus_cache_stats_scoped_entry_tags").truncate();
	if (!redisConfigAvailable()) return;
	const redis = useRedis();
	await redis.del(streamKey());
	await deleteStatsKeysByPattern(redis, `${statsNamespace()}:anom:*`);
	await deleteStatsKeysByPattern(redis, `${statsNamespace()}:tomb:*`);
}

//#endregion
export { CACHE_LATENCY_METRICS, CACHE_TIMESERIES_MAX_BUCKETS, CACHE_TIMESERIES_MIN_BUCKETS, cacheStatsActive, cacheStatsConfigured, claimCacheAnomalyThrottleSlot, clampCacheStatsWindow, drainCacheEvents, effectiveTtlByBucket, enforceCacheStatsBudget, evictCacheEntriesForPath, evictCacheEntry, flushCacheEventBuffer, getCacheStatsState, listCacheAnomalies, listCacheEntries, listCacheGroupLatencies, listPurgesCoveringEntry, queueCacheAnomaly, queueCacheDescriptor, queueCacheHit, queueCacheMiss, queueCachePurge, queueMissLatency, readCacheDescriptorForRedisKey, readCacheMissGap, readCacheTimeseries, readCacheTombstone, reapCacheAnomalies, reapCacheConfigEvents, reapCacheDescriptors, reapCacheEvents, reapCachePurges, reapScopedCacheEntryTags, reapScopedCachePurgeTags, recordCacheConfigEvent, refreshCacheStatsFlag, setCacheStatsEnabled, subscribeCacheStatsToggle, truncateCacheEvents, writeCacheTombstone };