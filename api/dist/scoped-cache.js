import { getMilliseconds } from "./utils/get-milliseconds.js";
import { useLogger } from "./logger/index.js";
import { useRedis } from "./redis/lib/use-redis.js";
import { redisConfigAvailable } from "./redis/utils/redis-config-available.js";
import "./redis/index.js";
import { resolvedCacheTtl } from "./cache-config.js";
import { extractFieldsFromQuery } from "./permissions/modules/process-ast/lib/extract-fields-from-query.js";
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
/**
* The collections a read depends on BEYOND the parent rows it nested, so keying the
* pin on those rows would leave the entry alive through a write that changes
* what the read returns.
*
* - A query filters, sorts, groups or aggregates on a path into it (permission cases
*   joined the way the SQL WHERE joins them), so rows the response never nested
*   decide which rows come back. Read off EVERY node's query, not only the root's: a
*   nested node's filter withholds parents, and which ones it withholds is
*   decided by every collection that filter reads — each of them one the
*   response may have nested only in part.
* - A nested node carries a field-level case, so a parent it references can be
*   withheld and arrive as a null slot — which `mergeWithParentItems` writes for
*   a null foreign key too, leaving the two indistinguishable once merged.
*/
function scopedCacheCollectionsBeyondNestedRows(schema, ast) {
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
		for (const [, entry] of [...queryFieldMap.read, ...queryFieldMap.other]) beyond.add(entry.collection);
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
			if (resolveScopedCacheM2oJoinChainFromPath(schema, rootCollection, segments) === null) {
				pinnableFromNestedRows = false;
				break;
			}
			const parentRows = m2oParentRowsAtPathEnd(records, segments);
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

//#endregion
export { assertScopedCacheRedisSupported, canonicalScopedCacheValue, composeScopedCachePaths, countScopedCacheTagMembers, createScopedCacheCollector, dropScopedCacheTagIndex, pinnedScopedCacheTagsFromFilter, pinnedScopedCacheTagsFromM2oParents, purgeCollectionScopedCache, purgeScopedCache, resolveScopedCacheM2oJoinChainFromPath, retryPendingScopedCachePurges, scopedCacheCollectionsBeyondNestedRows, scopedCacheCollectionsChangedByOnDelete, scopedCacheMaxPinsPerCollection, scopedCachePurgeEnabled, scopedCacheTagKey, scopedCacheTagLabel, scopedCacheTagsFromRows, serializeScopedCacheTags, startScopedCachePurgeRecovery, tagScopedCacheKeys };