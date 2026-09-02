import { getMilliseconds } from "./utils/get-milliseconds.js";
import { useLogger } from "./logger/index.js";
import { useRedis } from "./redis/lib/use-redis.js";
import { redisConfigAvailable } from "./redis/utils/redis-config-available.js";
import "./redis/index.js";
import { resolvedCacheTtl } from "./cache-config.js";
import { parseFilterKey } from "./utils/parse-filter-key.js";
import { getRelationInfo } from "./utils/get-relation-info.js";
import { findRelatedCollection } from "./permissions/modules/process-ast/utils/find-related-collection.js";
import { extractFieldsFromQuery } from "./permissions/modules/process-ast/lib/extract-fields-from-query.js";
import { hopsAcrossRelation, isFilterNode } from "./utils/filter-shape.js";
import { expandRelatedKeyFilters } from "./utils/expand-related-key-filters.js";
import { joinFilterWithCases } from "./database/run-ast/lib/apply-query/join-filter-with-cases.js";
import { queueCacheAnomaly, queueCachePurge } from "./cache-events.js";
import emitter_default from "./emitter.js";
import { clearPendingScopedCachePurges, countFailedScopedCachePurgeRetry, listPendingScopedCachePurges, recordPendingScopedCachePurge } from "./scoped-cache-pending-purges.js";
import { useEnv } from "@directus/env";

//#region src/scoped-cache.ts
const env = useEnv();
/**
* A per-operation collector backing the `context.scopedCache` hook handle. The
* service wires ONE of `scope`/`purge` as `context.scopedCache` per the filter event
* (read → `scope.scopeTo`, mutation → `purge.purgeBy`); the hook pushes via it and
* the service drains `tags` into the read's scope or the mutation's purge tags. Both
* are the same idempotent sink. Safe with purging off (then `tags` is unread).
*/
function createScopedCacheCollector(schema) {
	const tags = [];
	const seen = /* @__PURE__ */ new Set();
	const manuallyPurgedKeys = /* @__PURE__ */ new Set();
	const purgeSkippedKeys = /* @__PURE__ */ new Set();
	function withSchemaType(tag) {
		if (tag.type !== void 0 || tag.field === void 0) return tag;
		const schemaType = schema.collections[tag.collection]?.fields[tag.field]?.type;
		return schemaType === void 0 ? tag : {
			...tag,
			type: schemaType
		};
	}
	function add(input, manuallyPurged = false) {
		const batch = Array.isArray(input) ? input : [input];
		for (const declaredTag of batch) {
			const tag = withSchemaType(declaredTag);
			const key = scopedCacheTagKey(tag);
			if (manuallyPurged) manuallyPurgedKeys.add(key);
			if (seen.has(key)) continue;
			seen.add(key);
			tags.push(tag);
		}
	}
	return {
		tags,
		manuallyPurgedKeys,
		purgeSkippedKeys,
		scope: { scopeTo: (input, options) => add(input, options?.manuallyPurged) },
		purge: {
			purgeBy: (input) => add(input),
			skipPurgeFor: (key) => {
				purgeSkippedKeys.add(String(key));
			}
		}
	};
}
/**
* Whether scoped (tag-based) cache purging is active. Requires the opt-in mode AND a Redis cache
* store, since the tag→keys index lives in Redis sets. Any other config falls back to full flush.
*/
function scopedCachePurgeEnabled() {
	return env["CACHE_AUTO_PURGE_MODE"] === "scoped" && env["CACHE_STORE"] === "redis" && redisConfigAvailable();
}
/**
* Fail fast at startup: scoped cache purging drives Redis SCAN + multi-key DEL over a single
* node, so it only works on a standalone client. A cluster client would silently under-purge
* (keys on other nodes never scanned) and leave stale slices. `useRedis()` always builds a
* standalone `Redis` in core, so this only bites a custom override — surface it at boot rather
* than as a mid-request stale HIT.
*/
function assertScopedCacheRedisSupported() {
	if (scopedCachePurgeEnabled() && useRedis().isCluster) throw new Error("CACHE_AUTO_PURGE_MODE=scoped is not implemented for Redis cluster clients (SCAN and multi-key DEL are single-node). Use a standalone Redis or CACHE_AUTO_PURGE_MODE=full.");
}
function canonicalScopedCacheValue(value, type) {
	if (value === null || value === void 0) return "\0null";
	if (type === "boolean") return value === true || value === 1 || value === "1" || value === "t" || value === "true" ? "true" : "false";
	if (type === "date" || type === "dateTime" || type === "timestamp") {
		const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
		return Number.isNaN(ms) ? String(value) : String(ms);
	}
	if (type === "uuid") return String(value).toLowerCase();
	if (type === "integer" || type === "bigInteger") {
		const raw = String(value).trim();
		const digits = /^([+-]?)0*(\d+)$/.exec(raw);
		if (digits === null) {
			const num = Number(raw);
			return raw !== "" && Number.isSafeInteger(num) ? String(num) : raw;
		}
		return `${digits[1] === "-" && digits[2] !== "0" ? "-" : ""}${digits[2]}`;
	}
	if (type === "decimal" || type === "float") {
		const num = Number(value);
		return Number.isFinite(num) ? String(num) : String(value);
	}
	return String(value);
}
const PIN_UNSAFE_SCOPE_TYPES = new Set([
	"date",
	"dateTime",
	"timestamp"
]);
function isPinnableScopeType(type) {
	return !PIN_UNSAFE_SCOPE_TYPES.has(type);
}
function scopedCacheCollectionSlicesKey(collection) {
	return `${env["CACHE_NAMESPACE"]}:slices:${collection}`;
}
function scopedCacheTagKey(tag) {
	const base = `${env["CACHE_NAMESPACE"]}:tag:${tag.collection}`;
	return tag.field === void 0 ? base : `${base}:${tag.field}=${canonicalScopedCacheValue(tag.value, tag.type)}`;
}
function scopedCacheTagLabel(tag) {
	if (tag.field === void 0) return tag.collection;
	return `${tag.collection}:${tag.field}=${canonicalScopedCacheValue(tag.value, tag.type)}`;
}
function serializeScopedCacheTags(tags) {
	return tags.map(scopedCacheTagLabel).join(", ");
}
/**
* The collections a delete on `collection` also changes through the database's own
* `ON DELETE` rules. It applies them itself, so nothing else ever purges them.
*   - `CASCADE` deletes the rows, so the walk carries on into their own children.
*   - `SET NULL` and `SET DEFAULT` leave the rows in place carrying a changed
*     foreign key — a slice they have left — and stop there, since nothing below
*     a surviving row changes.
*   - a rule reaching back into `collection` reports it like any other: the rows
*     the database changes there are ones the caller never named, so the snapshot
*     taken from its keys does not cover them.
*   - the one exception is a DIRECT self-relation that only rewrites a foreign key.
*     Those rows survive in their slices, and finding which ones the rule moved
*     means scanning by a foreign key Directus does not index.
*/
function scopedCacheCollectionsChangedByOnDelete(schema, collection) {
	const changedCollections = /* @__PURE__ */ new Set();
	const walkedCollections = new Set([collection]);
	const pendingCollections = [collection];
	while (pendingCollections.length > 0) {
		const parentCollection = pendingCollections.shift();
		for (const relation of schema.relations) {
			const onDeleteRule = relation.schema?.on_delete;
			const childCollection = relation.collection;
			if (relation.related_collection !== parentCollection || onDeleteRule === void 0 || onDeleteRule === null || [
				"CASCADE",
				"SET NULL",
				"SET DEFAULT"
			].includes(onDeleteRule) === false) continue;
			if (parentCollection === collection && childCollection === collection && onDeleteRule !== "CASCADE") continue;
			changedCollections.add(childCollection);
			if (onDeleteRule === "CASCADE" && !walkedCollections.has(childCollection)) {
				walkedCollections.add(childCollection);
				pendingCollections.push(childCollection);
			}
		}
	}
	return [...changedCollections];
}
/**
* How much longer a tag set lives than the entries it indexes. Every write that
* files a key into the set re-`EXPIRE`s it, so at 1 it would already outlive its
* newest member; the doubling is slack, not arithmetic — for an entry orphaned by
* a crash between the write and its purge, and for siblings written outside this
* pipeline. A tag set holds keys, not payloads, so the slack is nearly free.
*/
const SCOPED_CACHE_TAG_TTL_FACTOR = 2;
/**
* Index a freshly-cached response key under every tag its data came from, so a later
* mutation can drop just the matching entries instead of the whole namespace. Both the
* payload key and its `__expires_at` sibling are tagged. When a cache TTL is set,
* each tag set self-expires at `SCOPED_CACHE_TAG_TTL_FACTOR` times that TTL, as a
* net for members orphaned by a crash between write and purge; with no TTL
* (`CACHE_TTL` unset) the cached entries never expire either, so the tag sets are
* left unbounded to match — a normal purge still drains them.
*/
async function tagScopedCacheKeys(key, scopedCacheTags, extraSiblings = []) {
	if (!scopedCachePurgeEnabled()) return;
	const taggedKeys = /* @__PURE__ */ new Set();
	for (const tag of scopedCacheTags) taggedKeys.add(scopedCacheTagKey(tag));
	if (taggedKeys.size === 0) return;
	const redis = useRedis();
	const ttlSeconds = Math.ceil(getMilliseconds(resolvedCacheTtl(), 0) / 1e3) * SCOPED_CACHE_TAG_TTL_FACTOR;
	const pipeline = redis.pipeline();
	const filedKeys = /* @__PURE__ */ new Set();
	for (const tag of scopedCacheTags) {
		const tagKey = scopedCacheTagKey(tag);
		if (filedKeys.has(tagKey)) continue;
		filedKeys.add(tagKey);
		pipeline.sadd(tagKey, key, `${key}__expires_at`, ...extraSiblings);
		if (ttlSeconds > 0) pipeline.expire(tagKey, ttlSeconds);
		if (tag.field === void 0) continue;
		const slicesKey = scopedCacheCollectionSlicesKey(tag.collection);
		pipeline.sadd(slicesKey, tagKey);
		if (ttlSeconds > 0) pipeline.expire(slicesKey, ttlSeconds);
	}
	await pipeline.exec();
}
/**
* How many cache entries each scoped tag currently indexes — the blast radius of
* purging that tag. Keyed by the tag's display string (`collection` or
* `collection:field=value`, which maps 1:1 to the `<namespace>:tag:<…>` set key).
*/
async function countScopedCacheTagMembers(displayTags) {
	if (!scopedCachePurgeEnabled() || displayTags.length === 0) return {};
	const pipeline = useRedis().pipeline();
	for (const tag of displayTags) pipeline.scard(scopedCacheTagKeyFromLabel(tag));
	const results = await pipeline.exec();
	const counts = {};
	displayTags.forEach((tag, index) => {
		counts[tag] = Number(results?.[index]?.[1] ?? 0);
	});
	return counts;
}
/**
* Delete the cache entries a set of tag keys point to, then drop the tag sets. Shared by
* the scoped purge (specific value slices) and the collection-wide fallback (every slice).
*
* Returns how many cache ENTRIES it actually deleted, which is neither how many
* keys it deleted nor how many the tag sets named.
*
* Not the key count, because a tag set holds each entry alongside its
* `__expires_at` sibling and any extra sibling (`__tags`), so counting members
* would report every entry twice over. A sidecar is recognisable by its base key
* being in the set beside it — the `sadd` writes them together — which stays
* right as siblings are added.
*
* Not the membership count either, because nothing ever SREMs: a member that
* expired by TTL stays named by the set until the set itself is dropped here. On
* the workload this fork exists for — per-user keys, so high cardinality, TTLs
* shorter than the gap between mutations — most of a set can be entries that were
* already gone, and counting them would inflate every purge figure on the page.
* So the store's own answer decides. Only an explicit `false` is evidence the key
* was absent; a store that reports nothing leaves the count where it was rather
* than silently collapsing it to zero.
*/
const SCOPED_CACHE_SIDECAR_SUFFIXES = ["__expires_at", "__tags"];
function scopedCacheSidecarOwner(member) {
	const suffix = SCOPED_CACHE_SIDECAR_SUFFIXES.find((candidate) => member.endsWith(candidate));
	return suffix === void 0 ? null : member.slice(0, -suffix.length);
}
async function purgeScopedCacheTagKeys(cache, tagKeys) {
	if (tagKeys.length === 0) return 0;
	const redis = useRedis();
	const memberLists = await Promise.all(tagKeys.map((tagKey) => redis.smembers(tagKey)));
	const members = [...new Set(memberLists.flat())];
	const wasDeleted = await Promise.all(members.map((member) => {
		return cache.delete(member);
	}));
	await redis.del(tagKeys);
	const tagPrefix = `${env["CACHE_NAMESPACE"]}:tag:`;
	const sliceKeysByCollection = /* @__PURE__ */ new Map();
	for (const tagKey of tagKeys) {
		const label = tagKey.startsWith(tagPrefix) ? tagKey.slice(tagPrefix.length) : "";
		const fieldAt = label.indexOf(":");
		if (fieldAt === -1) continue;
		const collection = label.slice(0, fieldAt);
		sliceKeysByCollection.set(collection, [...sliceKeysByCollection.get(collection) ?? [], tagKey]);
	}
	await Promise.all([...sliceKeysByCollection].map(([collection, sliceKeys]) => {
		return redis.srem(scopedCacheCollectionSlicesKey(collection), sliceKeys);
	}));
	const present = new Set(members);
	return members.filter((member, index) => {
		if (wasDeleted[index] === false) return false;
		const owner = scopedCacheSidecarOwner(member);
		return owner === null || present.has(owner) === false;
	}).length;
}
/**
* Cursor-scan every Redis key matching `match`. A single-node SCAN only covers the whole
* keyspace on a standalone client; a cluster would miss keys on other nodes. Scoped mode is
* refused on a cluster at startup (`assertScopedCacheRedisSupported`), so the client here is
* always standalone.
*/
async function scanScopedCacheTagKeys(match) {
	const redis = useRedis();
	const found = [];
	let cursor = "0";
	do {
		const [next, batch] = await redis.scan(cursor, "MATCH", match, "COUNT", 250);
		cursor = next;
		found.push(...batch);
	} while (cursor !== "0");
	return found;
}
/**
* Drop every scoped-tag index SET (`<namespace>:tag:*`). These are written direct
* via ioredis `sadd`, outside any Keyv namespace, so a response `cache.clear()`
* never reaches them — they would linger as orphan pointers until their `ttl*2`
* self-expiry. The `Response cache` flush calls this alongside `cache.clear()` for a
* clean wipe. Only the SET keys are dropped; the entries they pointed at are already
* gone with the namespace clear.
*/
async function dropScopedCacheTagIndex() {
	if (!redisConfigAvailable()) return;
	const tagKeys = [...await scanScopedCacheTagKeys(`${env["CACHE_NAMESPACE"]}:tag:*`), ...await scanScopedCacheTagKeys(`${env["CACHE_NAMESPACE"]}:slices:*`)];
	if (tagKeys.length === 0) return;
	await useRedis().del(tagKeys);
}
/**
* Purge every cached read of `collection` — its bare collection tag plus all its value
* slices — without full-flushing the namespace. The fallback when a mutation's scope
* values are unresolvable (e.g. an upsert mixing inserts and updates): which slices
* changed is unknown, but only reads touching THIS collection can be stale, so scope the
* flush to its tag sets and spare every other collection's entries.
*/
async function purgeCollectionScopedCache(cache, collection, scopedCachePurgeId) {
	const bareKey = `${env["CACHE_NAMESPACE"]}:tag:${collection}`;
	const startedAt = Date.now();
	const tagKeys = [bareKey, ...await useRedis().smembers(scopedCacheCollectionSlicesKey(collection))];
	const evicted = await purgeScopedCacheTagKeys(cache, tagKeys);
	queueCachePurge({
		purgeId: scopedCachePurgeId,
		collection,
		mode: "collection",
		scopedCacheTags: null,
		scopedCacheTagCount: tagKeys.length,
		evicted,
		durationMs: Date.now() - startedAt
	});
}
/**
* Run a purge, and on failure record it for a later retry instead of throwing.
*
* A purge is awaited by its mutation but runs after the transaction, so by the
* time it can fail the write is durable. Propagating the error would answer 500
* for a write that succeeded, and the client's natural response — retry — turns a
* stale cache entry into a duplicate row on any non-idempotent mutation. The
* entry is the smaller harm, so the request wins and the purge is finished later.
*
* Nothing is lost meanwhile: a cache read fails open (`cache.ts` catches and
* treats a Redis error as a MISS), so while Redis is unreachable no stale entry
* can be SERVED. The recorded purge only has to beat Redis coming back.
*
* Returns whether the purge ran, so the caller can skip the telemetry that would
* otherwise report a purge that did not happen.
*/
async function purgeOrRecord(run, pending) {
	try {
		await run();
		return true;
	} catch (error) {
		useLogger().warn(error, `[scoped-cache] purge failed and was recorded for retry: ${error}`);
		await recordPendingScopedCachePurge(pending, error);
		return false;
	}
}
/**
* Rebuild a tag key from the display label a pending purge stored. The label is
* namespace-free on purpose, so this resolves against whatever `CACHE_NAMESPACE`
* is at retry time rather than the one that was set when the purge failed.
*/
function scopedCacheTagKeyFromLabel(label) {
	return `${env["CACHE_NAMESPACE"]}:tag:${label}`;
}
let pendingScopedCachePurgeDrain = Promise.resolve(0);
/**
* Finish the purges that failed after their mutation committed. Called at boot
* and whenever the shared Redis client reports ready, which are the two moments a
* previously unreachable Redis can have come back.
*
* Serialized, never overlapped: `ready` can fire while a drain is still running,
* and two of them read the same rows and report the same stale entry to the
* anomaly stream twice. Chaining rather than sharing the in-flight promise, so a
* purge recorded mid-drain still gets its own pass instead of being answered by a
* run that started before it existed.
*/
function retryPendingScopedCachePurges() {
	const drained = pendingScopedCachePurgeDrain.catch(() => 0).then(() => drainPendingScopedCachePurges());
	pendingScopedCachePurgeDrain = drained;
	return drained;
}
/**
* Retries the recorded targets, never the namespace: a failure records what it
* could not drop, so recovery drops exactly that and every other slice stays
* warm. Returns how many recorded rows it cleared — not how many targets they
* collapsed into, since an outage records one slice once per write that touched
* it and the operator reads the table, not the grouping.
*/
/**
* Whether the response store can actually drop an entry right now.
*
* Keyv reports a store error by emitting `error` and answering `undefined`, so a
* failed `delete` is indistinguishable from a successful one at the call site —
* which is what let a drain clear its records while purging nothing. A write read
* back is the one answer that cannot be swallowed.
*
* The probe rides the cache's own namespace and carries a short ttl, so a process
* that dies between the write and the delete leaves nothing behind for long.
*/
async function scopedCacheStoreDropsEntries(cache) {
	const probeKey = "__scoped_cache_recovery_probe";
	try {
		await cache.set(probeKey, 1, 3e4);
		if (await cache.get(probeKey) !== 1) return false;
		await cache.delete(probeKey);
		return true;
	} catch {
		return false;
	}
}
async function drainPendingScopedCachePurges() {
	if (!redisConfigAvailable()) return 0;
	const pending = await listPendingScopedCachePurges();
	if (pending.length === 0) return 0;
	const { getCache } = await import("./cache.js");
	const { cache } = getCache();
	if (!cache) return 0;
	if (await scopedCacheStoreDropsEntries(cache) === false) return 0;
	let cleared = 0;
	for (const target of pending) {
		const tagKeys = target.scopedCacheTags.map(scopedCacheTagKeyFromLabel);
		try {
			try {
				await reportRecoveredScopedCacheEntries(tagKeys);
			} catch (error) {
				useLogger().warn(error, `[scoped-cache] could not name the entries a purge left stale: ${error}`);
			}
			if (target.mode === "namespace") await cache.clear();
			else if (target.mode === "collection") {
				if (target.collection === null) throw new Error(`collection-mode pending purge ${target.ids} names no collection`);
				await purgeCollectionScopedCache(cache, target.collection);
			} else await purgeScopedCacheTagKeys(cache, tagKeys);
			await clearPendingScopedCachePurges(target.ids);
			cleared += target.ids.length;
		} catch (error) {
			await countFailedScopedCachePurgeRetry(target.ids, error);
		}
	}
	return cleared;
}
/**
* Start finishing purges that failed after their mutation committed.
*
* Two triggers, because there are two ways a recorded purge becomes runnable
* again: the process restarted (boot) and the client reconnected (`ready`).
* ioredis emits `ready` on the first connect too, so the boot call only matters
* when the client was already up before this listener existed.
*
* Not awaited by the caller — recovery is bounded by how much failed, and a boot
* that blocked on it would be held up by the same Redis that is still down.
*/
function startScopedCachePurgeRecovery() {
	if (!redisConfigAvailable()) return;
	const logger = useLogger();
	const recover = () => {
		retryPendingScopedCachePurges().then((finished) => {
			if (finished > 0) logger.info(`[scoped-cache] finished ${finished} pending purge(s)`);
		}).catch((error) => {
			logger.warn(error, `[scoped-cache] pending purge retry failed: ${error}`);
		});
	};
	useRedis().on("ready", recover);
	import("./cache.js").then(({ getCache }) => {
		const { cache } = getCache();
		((cache?.store)?.client)?.on?.("ready", recover);
	});
	recover();
}
/**
* Name the entries a failed purge left stale, on the way to finally dropping
* them. Emitted HERE rather than at failure time because the anomaly stream is
* itself Redis-backed — reporting when the purge failed would report nothing in
* the one case worth reporting, a Redis outage.
*
* Best-effort: an entry with no descriptor (stats were off when it was filled)
* is purged all the same, it just cannot be named on the admin page.
*/
async function reportRecoveredScopedCacheEntries(tagKeys) {
	if (tagKeys.length === 0) return;
	const { readCacheDescriptorForRedisKey } = await import("./cache-events.js");
	const redis = useRedis();
	const memberLists = await Promise.all(tagKeys.map((key) => redis.smembers(key)));
	const members = [...new Set(memberLists.flat())].filter((member) => {
		return scopedCacheSidecarOwner(member) === null;
	});
	for (const member of members) {
		const descriptor = await readCacheDescriptorForRedisKey(member);
		if (descriptor === null) continue;
		queueCacheAnomaly({
			cacheKey: descriptor.cacheKey,
			reason: "redis_error",
			detail: "served stale until a failed purge was retried"
		});
	}
}
/**
* Purge cached responses affected by a mutation on `collection`. Outside scoped mode
* the whole data cache is flushed (legacy `cache.clear()` behavior). In scoped mode
* the bare collection tag (global reads) is always purged alongside the resolved
* `scopedCacheTags` (the owner/partition slices the mutation touched), leaving every
* other slice untouched. A `null` `scopedCacheTags` means "values couldn't be
* resolved" → fall back to a collection-wide purge (bare tag + every slice) rather than
* risk leaving a slice stale; still narrower than nuking the whole namespace.
*
* To purge EVERY entry of a collection, pass `null` — it dispatches to
* `purgeCollectionScopedCache`, which reads the collection's own slice index and
* drops the bare tag plus every slice key it names. A bare `[{ collection }]` in the
* tag list is NOT that: this function deletes exactly the keys it is handed, and a
* read pinned to a slice (an owner, or its primary key) carries no bare tag, so it
* survives.
*
* `includeCollectionTag: false` drops the bare `{ collection }` tag from the purge —
* for a cancelled mutation nothing in `collection` changed, so only the hook's own
* declared (usually foreign) slices should drop, not this collection's global reads.
*/
async function purgeScopedCache(cache, collection, scopedCacheTags = [], context = null, options = {}) {
	const startedAt = Date.now();
	if (!scopedCachePurgeEnabled()) {
		if (!await purgeOrRecord(() => cache.clear(), {
			mode: "namespace",
			collection: null,
			scopedCacheTags: []
		})) return null;
		queueCachePurge({
			purgeId: options.scopedCachePurgeId,
			collection: null,
			mode: "namespace",
			scopedCacheTags: null,
			scopedCacheTagCount: 0,
			evicted: null,
			durationMs: Date.now() - startedAt
		});
		return null;
	}
	if (scopedCacheTags === null) {
		await purgeOrRecord(() => {
			return purgeCollectionScopedCache(cache, collection, options.scopedCachePurgeId);
		}, {
			mode: "collection",
			collection,
			scopedCacheTags: []
		});
		return [{ collection }];
	}
	const resolvedScopedCacheTags = await emitter_default.emitFilter("cache.purge", options.includeCollectionTag === false ? [...scopedCacheTags] : [{ collection }, ...scopedCacheTags], { collection }, context);
	const tagKeys = [...new Set(resolvedScopedCacheTags.map(scopedCacheTagKey))];
	let evicted = null;
	if (!await purgeOrRecord(async () => {
		evicted = await purgeScopedCacheTagKeys(cache, tagKeys);
	}, {
		mode: "slices",
		collection,
		scopedCacheTags: resolvedScopedCacheTags.map(scopedCacheTagLabel)
	})) return resolvedScopedCacheTags;
	queueCachePurge({
		purgeId: options.scopedCachePurgeId,
		collection,
		mode: "slices",
		scopedCacheTags: resolvedScopedCacheTags.map(scopedCacheTagLabel),
		scopedCacheTagCount: tagKeys.length,
		evicted,
		durationMs: Date.now() - startedAt
	});
	return resolvedScopedCacheTags;
}
function scopedCacheTagsFromRows(collection, fields, rows, onUnresolvable, fieldTypes = {}) {
	const tags = [];
	for (const field of fields) {
		const seen = /* @__PURE__ */ new Set();
		for (const row of rows) {
			if (!(field in row)) {
				if (onUnresolvable === "coarse") return null;
				continue;
			}
			const value = row[field];
			const token = canonicalScopedCacheValue(value, fieldTypes[field]);
			if (seen.has(token)) continue;
			seen.add(token);
			tags.push({
				collection,
				field,
				value,
				type: fieldTypes[field]
			});
		}
	}
	return tags;
}
/**
* Resolve a dotted path into the chain of M2O joins it crosses, from `collection`
* down. Null on anything that is not an M2O — a to-many hop, an unknown field, or an
* A2O, whose relation names no single related collection — and every caller then
* degrades to the bare collection tag.
*
* A row maps to exactly one parent across an M2O, so what such a join reaches is
* fully determined by the rows already in hand. Shared, so the two sides that ask
* "is this path pinnable?" cannot drift apart on the answer: a collection's declared
* scope paths, and the nested collections of a read.
*/
function resolveScopedCacheM2oJoinChainFromPath(schema, collection, path) {
	const joins = [];
	let current = collection;
	for (const field of path) {
		const relatedCollection = schema.relations.find((rel) => {
			return rel.collection === current && rel.field === field;
		})?.related_collection;
		const relatedPk = relatedCollection ? schema.collections[relatedCollection]?.primary : void 0;
		if (!relatedCollection || !relatedPk) return null;
		joins.push({
			field,
			relatedCollection,
			relatedPk
		});
		current = relatedCollection;
	}
	return joins;
}
/**
* Field paths to inject so a read's ownership ANCESTORS — the collections its
* scope chain crosses toward the owner — come back as rows and pin by key, not
* the bare tag a read that nested none of them (`fields: ['*']`) over-purges on.
*
* Walks the same flat-field M2O chain `composeScopedCachePaths` does: each
* collection names its parent, so ownership composes hop by hop. A path per
* intermediate ancestor, ending at that ancestor's own pk so it carries its key
* in the response (run-ast's linking pk is temporary and stripped). The terminal
* owner — no scope of its own — is the value slice's root, left un-nested.
*/
function scopedCacheOwnershipNestedPkPaths(schema, collection) {
	const paths = /* @__PURE__ */ new Set();
	const walk = (current, prefix, visited) => {
		if (visited.has(current)) return;
		const seen = new Set(visited).add(current);
		for (const field of schema.collections[current]?.scopedCacheFields ?? []) {
			if (field.includes(".")) continue;
			const target = schema.relations.find((rel) => {
				return rel.collection === current && rel.field === field;
			})?.related_collection;
			const targetPk = target ? schema.collections[target]?.primary : void 0;
			const targetHasScope = (schema.collections[target ?? ""]?.scopedCacheFields ?? []).length > 0;
			if (!target || !targetPk || !targetHasScope) continue;
			const targetPrefix = prefix === "" ? field : `${prefix}.${field}`;
			paths.add(`${targetPrefix}.${targetPk}`);
			walk(target, targetPrefix, seen);
		}
	};
	walk(collection, "", /* @__PURE__ */ new Set());
	const nested = [...paths];
	return nested.some((path) => path.split(".").length > 2) ? nested : [];
}
/**
* How many slices one nested collection may pin on a single read. Every tag costs
* a Redis set plus a slice-index member, and the write side deletes them one by one.
*
* Sized above a default page of nested parents (the default `limit` is 100), below
* an import-sized one. NOT the bound
* https://github.com/jclaveau/directus/issues/392 is deciding, though both coarsen
* rather than fan out and both fail toward over-purge:
*
* - #392 bounds what a WRITE emits, forced by Postgres's 65 535 bind parameters,
*   and picks its number from the purge crossover. Above it a whole collection's
*   cache goes.
* - This bounds what a READ attaches. Nothing structural forces it, and a read
*   never purges — so the crossover #392 measures does not apply. Above it this
*   one response loses its pin and is still cached.
*
* Operator-tunable because the right number is deployment-specific — it weighs
* Redis memory against the hit ratio the pin buys, and a pin costs a tag set plus a
* member of the collection's slice index (130 B measured, on a TTL every write
* refreshes). No setting of it can serve a stale row.
*/
function scopedCacheMaxPinsPerCollection() {
	return env["CACHE_SCOPED_MAX_PINS_PER_COLLECTION"];
}
/**
* The parent rows sitting at the END of one M2O path, in document order — the set is
* replaced at every hop, so the rows passed through on the way out are not returned.
*
* Null when the response cannot answer the path — a segment it never carried, or an
* array where an M2O promised one row — so the caller falls back to the bare tag
* rather than pin a set it only half read.
*/
function m2oParentRowsAtPathEnd(records, segments) {
	let current = records;
	for (const segment of segments) {
		const next = [];
		for (const row of current) {
			const value = row[segment];
			if (value === null) continue;
			if (typeof value !== "object" || Array.isArray(value)) return null;
			next.push(value);
		}
		current = next;
	}
	return current;
}
const KEYING_UNKEYED = { kind: "unkeyed" };
const KEYING_ABSENT = { kind: "absent" };
function keyedAxisAcross(parts) {
	let field;
	const keys = /* @__PURE__ */ new Set();
	for (const part of parts) {
		if (part.kind !== "keyed" && part.kind !== "independent") continue;
		if (field !== void 0 && field !== part.field) return "conflict";
		field = part.field;
		for (const key of part.keys) keys.add(key);
	}
	if (field === void 0) return null;
	return {
		field,
		keys
	};
}
/**
* Conjunction. Every condition here describes the SAME joined row, so one of them
* naming that row's key pins it whatever the others go on to read off it:
* `{ _and: [{ course: { id: { _eq: 7 } } }, { course: { name: { _eq: 'x' } } }] }`
* compiles to one join alias, and only course 7 can satisfy it.
*/
function keyingOfEveryCondition(parts) {
	const axis = keyedAxisAcross(parts);
	if (axis === "conflict") return KEYING_UNKEYED;
	if (parts.some((part) => part.kind === "unkeyed")) return axis === null ? KEYING_UNKEYED : {
		kind: "keyed",
		field: axis.field,
		keys: axis.keys
	};
	if (axis !== null && parts.some((part) => part.kind === "keyed")) return {
		kind: "keyed",
		field: axis.field,
		keys: axis.keys
	};
	if (axis !== null && parts.some((part) => part.kind === "independent")) return {
		kind: "independent",
		field: axis.field,
		keys: axis.keys
	};
	return KEYING_ABSENT;
}
/**
* Disjunction. A row coming back through an unkeyed branch was reached through
* rows the filter never named, so one such branch takes the whole disjunction
* down; otherwise the keys are the union, since a row satisfies some branch. A
* branch that never mentions the collection contributes `absent`, not a
* fallback — it reads none of its rows.
*/
function keyingOfAnyCondition(parts) {
	if (parts.some((part) => part.kind === "unkeyed")) return KEYING_UNKEYED;
	const axis = keyedAxisAcross(parts);
	if (axis === "conflict") return KEYING_UNKEYED;
	if (axis !== null && parts.some((part) => part.kind === "keyed")) return {
		kind: "keyed",
		field: axis.field,
		keys: axis.keys
	};
	if (axis !== null && parts.some((part) => part.kind === "independent")) return {
		kind: "independent",
		field: axis.field,
		keys: axis.keys
	};
	return KEYING_ABSENT;
}
function combineKeyingByAlias(parts, combine) {
	const aliases = /* @__PURE__ */ new Set();
	for (const part of parts) for (const alias of part.keys()) aliases.add(alias);
	const combined = /* @__PURE__ */ new Map();
	for (const alias of aliases) {
		const atAlias = parts.map((part) => part.get(alias) ?? KEYING_ABSENT);
		combined.set(alias, combine(atAlias));
	}
	return combined;
}
/**
* The keys an M2O hop names when its conditions are answered by the near row's own
* foreign key column, so no row of the related collection is depended on — or null
* when the far row does have to be read.
*
* Three things have to hold. The relation must be an M2O, so the column is on this
* side. The conditions must name the related primary key and nothing else — a
* sibling on any other column has to read the far row. And the relation must carry
* a database constraint (`relation.schema`): without one a far row can be deleted
* behind the near row's back, leaving a foreign key that no longer joins, and the
* result changes with nothing written on this side.
*
* The constraint is taken to be enforced for the rows already there. A Postgres
* foreign key added `NOT VALID` reports as a constraint while tolerating the
* orphans that predate it, and would make this verdict wrong — Directus creates
* no such constraint, and the schema snapshot does not carry its validity.
*/
function nearRowAnswerKeys(schema, collection, fieldName, conditions) {
	const { relation, relationType } = getRelationInfo(schema.relations, collection, fieldName);
	if (relationType !== "m2o" || !relation?.schema || !relation.related_collection) return null;
	const relatedPrimaryKey = schema.collections[relation.related_collection]?.primary;
	const named = Object.keys(conditions);
	if (relatedPrimaryKey === void 0 || named.length !== 1) return null;
	if (named[0] !== relatedPrimaryKey) return null;
	const terminal = conditions[relatedPrimaryKey];
	if (terminal === null || typeof terminal !== "object" || Array.isArray(terminal)) return null;
	const operators = terminal;
	if (!Object.keys(operators).every((child) => child.startsWith("_"))) return null;
	if ("_eq" in operators) return new Set([operators["_eq"]]);
	if ("_in" in operators && Array.isArray(operators["_in"])) return new Set(operators["_in"]);
	return /* @__PURE__ */ new Set();
}
/**
* Walk one filter and report, per join alias, what it says about the rows it
* reaches. `collectionByAlias` is filled as the walk crosses relations, so the
* caller can fold aliases back onto the collections they name.
*
* Every hop is followed, not only the M2O ones
* `resolveScopedCacheM2oJoinChainFromPath` accepts: what a hop reaches at its FAR
* end is named by the key the condition
* gives, whichever direction the relation runs. `filter/index.ts` joins O2M, M2M
* and A2O the same way it joins M2O, and `_some`/`_none` push the same condition
* into a subquery over the same one row.
*/
function scopedCacheFilterKeyingByAlias(schema, collection, filter, alias, collectionByAlias) {
	collectionByAlias.set(alias, collection);
	const parts = [];
	const unkeyEverythingUnder = (node) => {
		const swept = scopedCacheFilterKeyingByAlias(schema, collection, node, alias, collectionByAlias);
		for (const sweptAlias of swept.keys()) parts.push(new Map([[sweptAlias, KEYING_UNKEYED]]));
		parts.push(new Map([[alias, KEYING_UNKEYED]]));
	};
	for (const [key, value] of Object.entries(filter)) {
		if ((key === "_and" || key === "_or") && Array.isArray(value)) {
			parts.push(combineKeyingByAlias(value.map((branch) => {
				return scopedCacheFilterKeyingByAlias(schema, collection, branch, alias, collectionByAlias);
			}), key === "_and" ? keyingOfEveryCondition : keyingOfAnyCondition));
			continue;
		}
		if ((key === "_some" || key === "_none") && isFilterNode(value)) {
			parts.push(scopedCacheFilterKeyingByAlias(schema, collection, value, alias, collectionByAlias));
			continue;
		}
		if (key.startsWith("_")) {
			if (isFilterNode(value)) unkeyEverythingUnder(value);
			else parts.push(new Map([[alias, KEYING_UNKEYED]]));
			continue;
		}
		if (isFilterNode(value) === false) {
			parts.push(new Map([[alias, KEYING_UNKEYED]]));
			continue;
		}
		const conditions = value;
		const [pathField, pathScope] = key.split(":");
		const { fieldName, functionName } = parseFilterKey(pathField);
		if (pathScope !== void 0 && schema.collections[pathScope] === void 0) {
			parts.push(new Map([[alias, KEYING_UNKEYED]]));
			continue;
		}
		const relatedCollection = pathScope ?? findRelatedCollection(collection, fieldName, schema);
		const childAlias = alias === "" ? key : `${alias}.${key}`;
		if (relatedCollection !== null && functionName !== void 0) {
			collectionByAlias.set(childAlias, relatedCollection);
			parts.push(new Map([[childAlias, KEYING_UNKEYED]]));
			parts.push(new Map([[alias, KEYING_UNKEYED]]));
			continue;
		}
		if (relatedCollection !== null && hopsAcrossRelation(conditions)) {
			const nearRowKeys = nearRowAnswerKeys(schema, collection, fieldName, conditions);
			if (nearRowKeys !== null) {
				collectionByAlias.set(childAlias, relatedCollection);
				const relatedPrimaryKey = schema.collections[relatedCollection]?.primary ?? "";
				parts.push(new Map([[childAlias, {
					kind: "independent",
					field: relatedPrimaryKey,
					keys: nearRowKeys
				}]]));
				parts.push(new Map([[alias, isScopedCacheKeyableField(schema, collection, fieldName) ? {
					kind: "keyed",
					field: fieldName,
					keys: nearRowKeys
				} : KEYING_UNKEYED]]));
				continue;
			}
			parts.push(scopedCacheFilterKeyingByAlias(schema, relatedCollection, conditions, childAlias, collectionByAlias));
			parts.push(new Map([[alias, KEYING_UNKEYED]]));
			continue;
		}
		parts.push(new Map([[alias, keyingOfColumnConditions(schema, collection, fieldName, functionName, conditions)]]));
	}
	return combineKeyingByAlias(parts, keyingOfEveryCondition);
}
/**
* What one column's conditions say about the rows they can match. Only the
* primary key under `_eq`/`_in` names them: any other column matches rows by a
* value a write can move onto a row this read never saw, and any other operator
* describes rows by what they are NOT. A function key (`year(created_on)`)
* reads the column through a transform, so it names nothing either.
*
* An empty `_in` matches no row and so depends on none, but it is reported
* unkeyed rather than as an empty key set: pinning a collection to nothing would
* drop its tag altogether, and a bare tag is the cheaper way to be right about a
* query that returns nothing.
*/
function isScopedCacheKeyableField(schema, collection, fieldName) {
	const scopedFlatFields = (schema.collections[collection]?.scopedCacheFields ?? []).filter((field) => !field.includes("."));
	if (fieldName !== schema.collections[collection]?.primary && !scopedFlatFields.includes(fieldName)) return false;
	const keyType = schema.collections[collection]?.fields[fieldName]?.type;
	return isPinnableScopeType(keyType);
}
function keyingOfColumnConditions(schema, collection, fieldName, functionName, conditions) {
	if (functionName !== void 0 || !isScopedCacheKeyableField(schema, collection, fieldName)) return KEYING_UNKEYED;
	if ("_eq" in conditions) return {
		kind: "keyed",
		field: fieldName,
		keys: new Set([conditions["_eq"]])
	};
	if ("_in" in conditions && Array.isArray(conditions["_in"])) {
		const keys = new Set(conditions["_in"]);
		if (keys.size > 0) return {
			kind: "keyed",
			field: fieldName,
			keys
		};
	}
	return KEYING_UNKEYED;
}
/**
* What every filter a read carries says about each collection it joins to — the
* root query's, and every nested node's, each with the permission cases folded in
* the way the SQL WHERE folds them.
*
* Aliases are folded back onto collections by the disjunction rule: two paths to
* one collection join two independent rows, so one unkeyed path leaves every row
* of that collection able to change the result, and otherwise the keys are the
* union of what each path named. Each node folds its own aliases, since alias
* `''` means a different collection in every one of them.
*
* Shared by the two sides that must agree on it — the tags a keyed collection
* pins, and the collections that consequently need NOT fall back to the bare tag
* — so neither can drift from the other's answer.
*/
function scopedCacheFilterKeyingByCollection(schema, ast) {
	const keyingByCollection = /* @__PURE__ */ new Map();
	const readKeyingOf = (collection, query, cases) => {
		const filter = joinFilterWithCases(query.filter, cases);
		if (!filter) return;
		const collectionByAlias = /* @__PURE__ */ new Map();
		const keyingByAlias = scopedCacheFilterKeyingByAlias(schema, collection, expandRelatedKeyFilters(schema, collection, filter), "", collectionByAlias);
		for (const [alias, keying] of keyingByAlias) {
			const aliasCollection = collectionByAlias.get(alias);
			if (aliasCollection === void 0) continue;
			const known = keyingByCollection.get(aliasCollection) ?? KEYING_ABSENT;
			keyingByCollection.set(aliasCollection, keyingOfAnyCondition([known, keying]));
		}
	};
	readKeyingOf(ast.name, ast.query, ast.cases);
	const readKeyingOfChildren = (children) => {
		for (const child of children) {
			if (child.type === "field") continue;
			if (child.type === "functionField") {
				readKeyingOf(child.relatedCollection, child.query, child.cases);
				continue;
			}
			if (child.type === "a2o") {
				for (const name of child.names) {
					readKeyingOf(name, child.query[name] ?? {}, child.cases[name] ?? []);
					readKeyingOfChildren(child.children[name] ?? []);
				}
				continue;
			}
			readKeyingOf(child.name, child.query, child.cases);
			readKeyingOfChildren(child.children);
		}
	};
	readKeyingOfChildren(ast.children);
	return keyingByCollection;
}
/**
* Scope a read's joined collections off the keys its filters named — the third
* pinner beside `pinnedScopedCacheTagsFromFilter`, which bounds the root off the
* same filter, and `pinnedScopedCacheTagsFromM2oParents`, which pins the nested
* ones off the rows they carried.
*
* A collection reached ONLY through a filter is nested nowhere, so neither of
* those two can say anything about it and it has always fallen through to the
* bare tag — one write anywhere in it dropping every read that merely joined it.
* When the filter named its rows by key, the read depends on those rows and no
* others, so `<collection>:<pk>=<key>` is exactly right and the write side
* already emits it: `snapshotScopedCacheTags` writes the key slice of every
* mutated row of every collection, declared scope fields or not.
*
* The root is left out: its own filter bounds it through
* `pinnedScopedCacheTagsFromFilter`, under a self-reference guard this analysis
* does not reproduce.
*
* Past the per-collection ceiling the pin is dropped rather than trimmed — a
* partial key set would leave the rows it omits covered by nothing.
*/
function pinnedScopedCacheTagsFromKeyedFilters(schema, rootCollection, keyingByCollection) {
	const pinned = /* @__PURE__ */ new Map();
	for (const [collection, keying] of keyingByCollection) {
		if (collection === rootCollection || keying.kind !== "keyed") continue;
		const type = schema.collections[collection]?.fields[keying.field]?.type;
		if (type === void 0) continue;
		if (keying.keys.size > scopedCacheMaxPinsPerCollection()) continue;
		const tags = [];
		const seen = /* @__PURE__ */ new Set();
		for (const value of keying.keys) {
			const token = canonicalScopedCacheValue(value, type);
			if (seen.has(token)) continue;
			seen.add(token);
			tags.push({
				collection,
				field: keying.field,
				value,
				type
			});
		}
		pinned.set(collection, tags);
	}
	return pinned;
}
/**
* The collections the read NESTS — every one that has a node of its own in the
* AST, whichever direction its relation runs.
*
* A nested collection is depended on for the rows it CARRIED, not only for the
* ones a filter named: `mergeWithParentItems` writes what the nested query
* returned, so an insert that joins it changes the response. Only
* `pinnedScopedCacheTagsFromM2oParents` can name that half, and it declines a
* to-many or A2O hop. Naming them here lets the caller keep such a collection
* bare even when its filter named keys — those keys cover the filter's half of
* the dependency and say nothing about the nested one.
*/
function scopedCacheNestedCollections(ast) {
	const nested = /* @__PURE__ */ new Set();
	const addNestedBy = (children) => {
		for (const child of children) {
			if (child.type === "field" || child.type === "functionField") continue;
			if (child.type === "a2o") {
				for (const name of child.names) {
					nested.add(name);
					addNestedBy(child.children[name] ?? []);
				}
				continue;
			}
			nested.add(child.name);
			addNestedBy(child.children);
		}
	};
	addNestedBy(ast.children);
	return nested;
}
/**
* The collections a read depends on BEYOND the parent rows it nested, so keying the
* pin on those rows would leave the entry alive through a write that changes
* what the read returns.
*
* - A query sorts, groups or aggregates on a path into it, so rows the response
*   never nested decide which rows come back, named by nothing.
* - A query FILTERS on a path into it that names no key (`keyingByCollection`),
*   same reason. A filter that does name keys is the one case that survives:
*   the rows it reaches are exactly those keys, which
*   `pinnedScopedCacheTagsFromKeyedFilters` pins alongside whatever the response
*   nested. Read off EVERY node's query, not only the root's: a nested node's
*   filter withholds parents, and which ones it withholds is decided by every
*   collection that filter reads — each of them one the response may have nested
*   only in part.
* - A nested node carries a field-level case, so a parent it references can be
*   withheld and arrive as a null slot — which `mergeWithParentItems` writes for
*   a null foreign key too, leaving the two indistinguishable once merged.
*/
function scopedCacheCollectionsBeyondNestedRows(schema, ast, keyingByCollection = scopedCacheFilterKeyingByCollection(schema, ast)) {
	const beyond = /* @__PURE__ */ new Set();
	const addCollectionsQueriedBy = (collection, query, cases) => {
		const queryFieldMap = {
			read: /* @__PURE__ */ new Map(),
			other: /* @__PURE__ */ new Map()
		};
		extractFieldsFromQuery(collection, {
			...query,
			filter: joinFilterWithCases(query.filter, cases)
		}, queryFieldMap, schema);
		const sortedFieldMap = {
			read: /* @__PURE__ */ new Map(),
			other: /* @__PURE__ */ new Map()
		};
		const groupedFieldMap = {
			read: /* @__PURE__ */ new Map(),
			other: /* @__PURE__ */ new Map()
		};
		const sortedQuery = {};
		if (query.sort) sortedQuery.sort = query.sort;
		extractFieldsFromQuery(collection, sortedQuery, sortedFieldMap, schema);
		const groupedQuery = {};
		if (query.group) groupedQuery.group = query.group;
		if (query.aggregate) groupedQuery.aggregate = query.aggregate;
		extractFieldsFromQuery(collection, groupedQuery, groupedFieldMap, schema);
		const sorted = /* @__PURE__ */ new Set();
		for (const [, entry] of [...sortedFieldMap.read, ...sortedFieldMap.other]) sorted.add(entry.collection);
		const groupedOrAggregated = /* @__PURE__ */ new Set();
		for (const [, entry] of [...groupedFieldMap.read, ...groupedFieldMap.other]) groupedOrAggregated.add(entry.collection);
		for (const [, entry] of [...queryFieldMap.read, ...queryFieldMap.other]) {
			const collection$1 = entry.collection;
			const kind = keyingByCollection.get(collection$1)?.kind;
			const namedByFilter = kind === "keyed" || kind === "independent";
			const hasCoveringSlice = (schema.collections[collection$1]?.scopedCacheFields ?? []).length > 0;
			const crossesMembership = groupedOrAggregated.has(collection$1) || sorted.has(collection$1) && !hasCoveringSlice;
			if (namedByFilter && !crossesMembership) continue;
			beyond.add(collection$1);
		}
	};
	addCollectionsQueriedBy(ast.name, ast.query, ast.cases);
	const addWhatNestedM2oNodesDependOn = (children) => {
		for (const child of children) {
			if (child.type !== "m2o") continue;
			addCollectionsQueriedBy(child.relation.related_collection, child.query, child.cases);
			if (child.whenCase.length > 0) beyond.add(child.relation.related_collection);
			addWhatNestedM2oNodesDependOn(child.children);
		}
	};
	addWhatNestedM2oNodesDependOn(ast.children);
	return beyond;
}
/**
* Scope a read's NON-root collections off the parent rows it nested — the other
* half of `pinnedScopedCacheTagsFromFilter`, which bounds the root.
*
* Per touched collection, the first of these that holds:
*
* - `<pk>=<key>` per parent row — M2O hops only. An INSERT lands a key this
*   response cannot have nested, so the pin cannot go stale.
* - its own declared scope slices — past the ceiling. One tag per distinct value.
* - the bare collection tag — a to-many hop or A2O anywhere on one of its paths, no
*   parent row nested, a row missing its key, or the read depending on it
*   beyond what it nested (`scopedCacheCollectionsBeyondNestedRows`).
*
* Returns the pinned collections only; the bare tag is the caller's default, so a
* collection absent here keeps the tag it has always carried. Each fallback
* over-purges, none serves stale.
*/
function pinnedScopedCacheTagsFromM2oParents(schema, rootCollection, fieldMap, records, collectionsBeyondNestedRows) {
	const pathsByCollection = /* @__PURE__ */ new Map();
	for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) {
		if (entry.collection === rootCollection) continue;
		if (collectionsBeyondNestedRows.has(entry.collection)) continue;
		const paths = pathsByCollection.get(entry.collection) ?? /* @__PURE__ */ new Set();
		paths.add(path);
		pathsByCollection.set(entry.collection, paths);
	}
	const pinned = /* @__PURE__ */ new Map();
	for (const [collection, paths] of pathsByCollection) {
		const primaryKeyField = schema.collections[collection]?.primary;
		const collectionFields = schema.collections[collection]?.fields ?? {};
		if (primaryKeyField === void 0) continue;
		const rows = [];
		let pinnableFromNestedRows = true;
		for (const path of paths) {
			const segments = path.split(".");
			const lastField = segments[segments.length - 1];
			let parentRows;
			if (resolveScopedCacheM2oJoinChainFromPath(schema, rootCollection, segments) !== null) parentRows = m2oParentRowsAtPathEnd(records, segments);
			else {
				const parentCollection = scopedCacheCollectionAtPathEnd(schema, rootCollection, segments.slice(0, -1));
				if (parentCollection === null || lastField === void 0 || getRelationInfo(schema.relations, parentCollection, lastField).relationType !== "m2o") {
					pinnableFromNestedRows = false;
					break;
				}
				parentRows = scopedCacheRowsAtPathEnd(records, segments);
			}
			if (parentRows === null) {
				pinnableFromNestedRows = false;
				break;
			}
			for (const parentRow of parentRows) rows.push(parentRow);
		}
		if (pinnableFromNestedRows === false) continue;
		if (rows.length === 0) continue;
		const keyTags = scopedCacheTagsFromRows(collection, [primaryKeyField], rows, "coarse", { [primaryKeyField]: collectionFields[primaryKeyField]?.type });
		if (keyTags !== null && keyTags.length <= scopedCacheMaxPinsPerCollection()) {
			pinned.set(collection, keyTags);
			continue;
		}
		const sliceFields = (schema.collections[collection]?.scopedCacheFields ?? []).filter((field) => !field.includes("."));
		if (sliceFields.length === 0) continue;
		const sliceFieldTypes = {};
		for (const field of sliceFields) sliceFieldTypes[field] = collectionFields[field]?.type;
		const sliceTags = scopedCacheTagsFromRows(collection, sliceFields, rows, "coarse", sliceFieldTypes);
		if (sliceTags !== null && sliceTags.length <= scopedCacheMaxPinsPerCollection()) pinned.set(collection, sliceTags);
	}
	return pinned;
}
/**
* The collection a relational path ends at, walking an M2O into its one related row
* and an O2M into its children alike. Null on an A2O or unknown field, whose target
* is not a single collection.
*/
function scopedCacheCollectionAtPathEnd(schema, collection, segments) {
	let current = collection;
	for (const field of segments) {
		const { relation, relationType } = getRelationInfo(schema.relations, current, field);
		let related = null;
		if (relationType === "m2o") related = relation?.related_collection;
		else if (relationType === "o2m") related = relation?.collection;
		if (!related) return null;
		current = related;
	}
	return current;
}
/**
* Every row a relational path reaches, in document order, descending an M2O into its
* one related row and an O2M into each of its children — so a deep O2M prefix still
* yields the parent rows the pin keys on. Null when the response cannot answer the
* path: a segment it never carried, or a scalar where a relation was expected.
*/
function scopedCacheRowsAtPathEnd(records, segments) {
	let current = records;
	for (const segment of segments) {
		const next = [];
		for (const row of current) {
			const value = row[segment];
			if (value === null || value === void 0) continue;
			if (Array.isArray(value)) {
				for (const element of value) if (element !== null && typeof element === "object") next.push(element);
			} else if (typeof value === "object") next.push(value);
			else return null;
		}
		current = next;
	}
	return current;
}
/**
* The to-many twin of `pinnedScopedCacheTagsFromM2oParents`. A read that EMBEDS a
* to-many child set depends on every child WHERE `child.<fk> = parent.pk`, so it
* pins each such collection by that reverse fk = the parent's key — one tag per
* surfaced parent row. A write to a child of another parent no longer evicts it.
*
* The purge side already emits the identical `<child>:<fk>=<value>` shallow tag
* from the mutated row's own fk column (the flat scope-field branch of
* `snapshotScopedCacheTags`), so read and write agree by construction — no field
* injection, no response strip, no deep chain. The read never needs the child's fk
* value: it equals the parent pk by definition of the O2M join.
*
* Pins where the parent rows are in reach AND the write will match: the last hop is
* O2M whose reverse fk is a flat scope field (else the purge emits no match), and
* the prefix descends to parent rows carrying their key — through a to-many too,
* so a deep pivot under an all-O2M chain slices. Past the per-collection pin ceiling
* it falls back to the bare tag; an A2O anywhere on the path keeps it bare.
*/
function pinnedScopedCacheTagsFromO2mChildren(schema, rootCollection, fieldMap, records, collectionsBeyondNestedRows, conflictedOut) {
	const keyingByChild = /* @__PURE__ */ new Map();
	for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) {
		const childCollection = entry.collection;
		if (childCollection === rootCollection) continue;
		if (collectionsBeyondNestedRows.has(childCollection)) continue;
		const segments = path.split(".");
		const aliasField = segments[segments.length - 1];
		if (aliasField === void 0) continue;
		const prefix = segments.slice(0, -1);
		let parentCollection = rootCollection;
		if (prefix.length > 0) {
			const resolved = scopedCacheCollectionAtPathEnd(schema, rootCollection, prefix);
			if (resolved === null) continue;
			parentCollection = resolved;
		}
		const { relation, relationType } = getRelationInfo(schema.relations, parentCollection, aliasField);
		if (relationType !== "o2m" || !relation || relation.collection !== childCollection) continue;
		const reverseFk = relation.field;
		const parentPkField = schema.collections[parentCollection]?.primary;
		if (parentPkField === void 0) continue;
		if (!(schema.collections[childCollection]?.scopedCacheFields ?? []).filter((field) => !field.includes(".")).includes(reverseFk)) continue;
		const parentRows = prefix.length === 0 ? records : scopedCacheRowsAtPathEnd(records, prefix);
		if (parentRows === null) continue;
		const fieldType = schema.collections[childCollection]?.fields[reverseFk]?.type;
		const keying = keyingByChild.get(childCollection) ?? {
			reverseFk,
			fieldType,
			rows: [],
			conflicted: false
		};
		if (keying.reverseFk !== reverseFk) {
			keying.conflicted = true;
			keyingByChild.set(childCollection, keying);
			continue;
		}
		for (const parentRow of parentRows) keying.rows.push(parentPkField in parentRow ? { [reverseFk]: parentRow[parentPkField] } : {});
		keyingByChild.set(childCollection, keying);
	}
	const pinned = /* @__PURE__ */ new Map();
	for (const [collection, keying] of keyingByChild) {
		if (keying.conflicted && conflictedOut) conflictedOut.add(collection);
		if (keying.conflicted || keying.rows.length === 0) continue;
		const keyTags = scopedCacheTagsFromRows(collection, [keying.reverseFk], keying.rows, "coarse", { [keying.reverseFk]: keying.fieldType });
		if (keyTags !== null && keyTags.length <= scopedCacheMaxPinsPerCollection()) pinned.set(collection, keyTags);
	}
	return pinned;
}
/**
* Scope a read's root cache tags off a filter — the read side. A read is soundly scoped to a value
* slice only when the filter *bounds* it to that value: a future insert with a new scope value must
* be excluded by the same filter, or the read would silently miss it. Tags come from `_eq`/`_in` on
* a scoped field (flat or relational `{ fk: { <pk>: … } }`). Each node reports its tags plus whether
* it *covers* every row it matches (i.e. binds a pinnable field on that row), combined by operator:
*   - `_and`/root union a field's values and are covered if ANY conjunct is (a row satisfies every
*     conjunct); the value union over-approximates the intersection — over-purges, never stale.
*   - `_or` is sound only when EVERY branch is covered (else a row matching an uncovered branch
*     carries no pinned tag → stale); then its tags are the union across branches — a matching row
*     satisfies one branch, whose covering tag lies in that union. This holds across *different*
*     fields too: `{ _or: [{ owner }, { dept }] }` pins both, purged if a write touches either.
* This is what scopes a permission-isolated read: the caller passes
* `joinFilterWithCases(query.filter, ast.cases)`, whose `{ _or: cases }` is unioned by that rule
* (one case = its own values; a case that leaves ALL fields unbound → bare). No pinned field → `[]`,
* and the caller falls back to the bare collection tag. `fieldTypes` canonicalizes a value the way
* the purge side does and skips date-ish types (not pin-safe, `PIN_UNSAFE_SCOPE_TYPES`).
*
* `primaryKeyField` joins the declared fields implicitly and always, no config:
*   - Every row has a primary key, so this axis always resolves.
*   - An inserted row carries a different key, so it can never join a `<pk>._eq`
*     or `<pk>._in` read's result set — the insert-blindness that bars a value
*     slice elsewhere cannot bite here.
*   - The purge side emits the same tag from the keys it already holds, so read and
*     write agree without either paying a query for it.
*/
function pinnedScopedCacheTagsFromFilter(collection, fields, filter, fieldTypes = {}, relatedPrimaryKeys = {}, scopedCachePaths = [], primaryKeyField) {
	const fieldSet = new Set(fields);
	if (primaryKeyField !== void 0) fieldSet.add(primaryKeyField);
	if (!filter || fieldSet.size === 0 && scopedCachePaths.length === 0) return [];
	const pathsByHead = /* @__PURE__ */ new Map();
	for (const path of scopedCachePaths) {
		const head = path.segments[0];
		if (head === void 0) continue;
		const group = pathsByHead.get(head) ?? [];
		group.push(path);
		pathsByHead.set(head, group);
	}
	function unionTags(target, source) {
		for (const [field, values] of source) {
			const seen = target.get(field) ?? /* @__PURE__ */ new Set();
			for (const value of values) seen.add(value);
			target.set(field, seen);
		}
	}
	function evalLeaf(field, value) {
		const tags$1 = /* @__PURE__ */ new Map();
		if (!fieldSet.has(field) || !isPinnableScopeType(fieldTypes[field]) || value === null || typeof value !== "object") return {
			tags: tags$1,
			covered: false
		};
		const ops = value;
		if ("_eq" in ops) tags$1.set(field, new Set([ops["_eq"]]));
		else if ("_in" in ops && Array.isArray(ops["_in"])) tags$1.set(field, new Set(ops["_in"]));
		else {
			const relatedPrimaryKey = relatedPrimaryKeys[field];
			const inner = relatedPrimaryKey === void 0 ? void 0 : ops[relatedPrimaryKey];
			if (inner !== null && typeof inner === "object") {
				const innerOps = inner;
				if ("_eq" in innerOps) tags$1.set(field, new Set([innerOps["_eq"]]));
				else if ("_in" in innerOps && Array.isArray(innerOps["_in"])) tags$1.set(field, new Set(innerOps["_in"]));
			}
		}
		return {
			tags: tags$1,
			covered: tags$1.size > 0
		};
	}
	function pathTerminalValues(segments, value, terminalRelatedPk) {
		let node = value;
		for (let i = 1; i < segments.length; i++) {
			if (node === null || typeof node !== "object") return null;
			node = node[segments[i]];
		}
		if (node === null || typeof node !== "object") return null;
		const ops = node;
		if ("_eq" in ops) return new Set([ops["_eq"]]);
		if ("_in" in ops && Array.isArray(ops["_in"])) return new Set(ops["_in"]);
		const inner = terminalRelatedPk === void 0 ? void 0 : ops[terminalRelatedPk];
		if (inner !== null && typeof inner === "object") {
			const innerOps = inner;
			if ("_eq" in innerOps) return new Set([innerOps["_eq"]]);
			if ("_in" in innerOps && Array.isArray(innerOps["_in"])) return new Set(innerOps["_in"]);
		}
		return null;
	}
	function evalPathsAt(headField, value) {
		const tags$1 = /* @__PURE__ */ new Map();
		const paths = pathsByHead.get(headField);
		if (!paths || value === null || typeof value !== "object") return {
			tags: tags$1,
			covered: false
		};
		for (const { field, segments } of paths) {
			if (!isPinnableScopeType(fieldTypes[field])) continue;
			const values = pathTerminalValues(segments, value, relatedPrimaryKeys[field]);
			if (values !== null && values.size > 0) tags$1.set(field, values);
		}
		return {
			tags: tags$1,
			covered: tags$1.size > 0
		};
	}
	function evalOr(branches) {
		if (branches.length === 0 || !branches.every((branch) => branch.covered)) return {
			tags: /* @__PURE__ */ new Map(),
			covered: false
		};
		const tags$1 = /* @__PURE__ */ new Map();
		for (const branch of branches) unionTags(tags$1, branch.tags);
		return {
			tags: tags$1,
			covered: true
		};
	}
	function evalNode(node) {
		const result = {
			tags: /* @__PURE__ */ new Map(),
			covered: false
		};
		function andIn(part) {
			unionTags(result.tags, part.tags);
			result.covered = result.covered || part.covered;
		}
		for (const [key, value] of Object.entries(node)) if (key === "_and" && Array.isArray(value)) for (const sub of value) andIn(evalNode(sub));
		else if (key === "_or" && Array.isArray(value)) andIn(evalOr(value.map((sub) => evalNode(sub))));
		else {
			andIn(evalLeaf(key, value));
			andIn(evalPathsAt(key, value));
		}
		return result;
	}
	const pinned = evalNode(filter);
	const tags = [];
	for (const [field, values] of pinned.tags) for (const value of values) tags.push({
		collection,
		field,
		value,
		type: fieldTypes[field]
	});
	return tags;
}
/**
* Auto-derive multi-hop scope paths from LOCAL scope fields, so each collection
* declares only its own column and the grand-owner path composes itself. A scope
* field on `collection` that is an M2O to a collection which itself declares scope
* fields contributes `<field>.<targetScope>` for each of the target's scopes — its
* own and, transitively, its derived. So `team` scoped by `owner_ref` + `member`
* scoped by `team` yields `team.owner_ref`, no config naming another collection's
* relation. Cycle-guarded (`visited`); the caller re-resolves each path (a to-many
* hop drops to the bare tag).
*/
function composeScopedCachePaths(schema, collection, visited = /* @__PURE__ */ new Set()) {
	if (visited.has(collection)) return [];
	const seen = new Set(visited).add(collection);
	const localFields = schema.collections[collection]?.scopedCacheFields ?? [];
	const composed = [];
	for (const field of localFields) {
		if (field.includes(".")) continue;
		const target = schema.relations.find((rel) => {
			return rel.collection === collection && rel.field === field;
		})?.related_collection;
		if (!target) continue;
		for (const targetField of schema.collections[target]?.scopedCacheFields ?? []) composed.push({
			field: `${field}.${targetField}`,
			segments: [field, ...targetField.split(".")]
		});
		for (const deeper of composeScopedCachePaths(schema, target, seen)) composed.push({
			field: `${field}.${deeper.field}`,
			segments: [field, ...deeper.segments]
		});
	}
	return composed;
}
/**
* The paths a read can pin a would-be-bare nested collection BY, instead of the bare
* tag, when an ancestor its ownership chain crosses is itself pinned in the read —
* nearest first. Every row the collection surfaced belongs to that ancestor's slice,
* so a per-slice pin stands in for the whole-collection tag.
*
* Every hop is a scoped-cache ownership edge (`scopedCacheFields`), so a write to
* the near collection purges every key a candidate names — the invariant keeping the
* slice sound. `field` is the dotted key the matching pin's value slices on — the
* same key `composeScopedCachePaths` hands the purge, so read pin and purge agree;
* `ancestor` is the collection that key reaches; `terminalField` is the field on it
* a pin must name for the candidate to apply.
*
* Two shapes, both ownership-covered:
* - a flat parent fk (`discipline`) reaching the 1-hop ancestor by its own key, and
* - a composed relational path (`discipline.enrollment.student.user`) reaching a
*   deeper ancestor's scope field.
*/
function scopedCacheAncestorSliceCandidates(schema, collection) {
	const candidates = [];
	for (const field of schema.collections[collection]?.scopedCacheFields ?? []) {
		if (field.includes(".")) continue;
		const target = schema.relations.find((rel) => {
			return rel.collection === collection && rel.field === field;
		})?.related_collection;
		const targetPk = target ? schema.collections[target]?.primary : void 0;
		if (!target || !targetPk) continue;
		candidates.push({
			field,
			ancestor: target,
			terminalField: targetPk
		});
	}
	for (const path of composeScopedCachePaths(schema, collection)) {
		const terminalField = path.segments[path.segments.length - 1];
		const joins = resolveScopedCacheM2oJoinChainFromPath(schema, collection, path.segments.slice(0, -1));
		const ancestor = joins?.[joins.length - 1]?.relatedCollection;
		if (!ancestor || terminalField === void 0) continue;
		candidates.push({
			field: path.field,
			ancestor,
			terminalField
		});
	}
	return candidates.sort((a, b) => {
		return a.field.split(".").length - b.field.split(".").length;
	});
}

//#endregion
export { assertScopedCacheRedisSupported, canonicalScopedCacheValue, composeScopedCachePaths, countScopedCacheTagMembers, createScopedCacheCollector, dropScopedCacheTagIndex, pinnedScopedCacheTagsFromFilter, pinnedScopedCacheTagsFromKeyedFilters, pinnedScopedCacheTagsFromM2oParents, pinnedScopedCacheTagsFromO2mChildren, purgeCollectionScopedCache, purgeScopedCache, resolveScopedCacheM2oJoinChainFromPath, retryPendingScopedCachePurges, scopedCacheAncestorSliceCandidates, scopedCacheCollectionsBeyondNestedRows, scopedCacheCollectionsChangedByOnDelete, scopedCacheFilterKeyingByCollection, scopedCacheMaxPinsPerCollection, scopedCacheNestedCollections, scopedCacheOwnershipNestedPkPaths, scopedCachePurgeEnabled, scopedCacheTagKey, scopedCacheTagLabel, scopedCacheTagsFromRows, serializeScopedCacheTags, startScopedCachePurgeRecovery, tagScopedCacheKeys };