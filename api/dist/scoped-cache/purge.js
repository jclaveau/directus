import { getMilliseconds } from "../utils/get-milliseconds.js";
import { useLogger } from "../logger/index.js";
import { useRedis } from "../redis/lib/use-redis.js";
import { redisConfigAvailable } from "../redis/utils/redis-config-available.js";
import "../redis/index.js";
import { scopedCacheTagKey, scopedCacheTagLabel } from "./tags.js";
import emitter_default from "../emitter.js";
import { resolvedCacheTtl } from "../cache-config.js";
import { queueCacheAnomaly, queueCachePurge } from "../cache-events.js";
import { clearPendingScopedCachePurges, countFailedScopedCachePurgeRetry, listPendingScopedCachePurges, recordPendingScopedCachePurge } from "../scoped-cache-pending-purges.js";
import { useEnv } from "@directus/env";

//#region src/scoped-cache/purge.ts
const env = useEnv();
/**
* Whether scoped (tag-based) cache purging is active. Requires the opt-in mode AND a
* Redis cache store, since the tag→keys index lives in Redis sets. Any other config
* falls back to full flush.
*/
function scopedCachePurgeEnabled() {
	return env["CACHE_AUTO_PURGE_MODE"] === "scoped" && env["CACHE_STORE"] === "redis" && redisConfigAvailable();
}
/**
* Fail fast at startup: scoped cache purging drives Redis SCAN + multi-key DEL over
* a single node, so it only works on a standalone client. A cluster client would
* silently under-purge (keys on other nodes never scanned) and leave stale slices.
* `useRedis()` always builds a standalone `Redis` in core, so this only bites a
* custom override — surface it at boot rather than as a mid-request stale HIT.
*/
function assertScopedCacheRedisSupported() {
	if (scopedCachePurgeEnabled() && useRedis().isCluster) throw new Error("CACHE_AUTO_PURGE_MODE=scoped is not implemented for Redis cluster clients (SCAN and multi-key DEL are single-node). Use a standalone Redis or CACHE_AUTO_PURGE_MODE=full.");
}
/**
* A per-collection purge counter, bumped every time that collection's tags are
* dropped. `*` is the wholesale entry, bumped by a flush that names no collection.
*/
function scopedCacheEpochKey(collection) {
	return `${env["CACHE_NAMESPACE"]}:epoch:${collection}`;
}
/**
* Read the purge counters of the collections a read depends on.
*
* A read's tags reach the index only in `respond`, long after the rows were fetched:
* a purge landing in between finds nothing to drop, and the fill then stores rows it
* already superseded — stale for the whole TTL, and (its tag sets having just been
* deleted) unreachable to every later purge. Comparing the counter captured before
* the query against the one at fill time is what closes that window.
*/
async function readScopedCacheEpochs(collections) {
	if (!env["CACHE_ENABLED"] || !scopedCachePurgeEnabled() || !redisConfigAvailable()) return {};
	const names = [...new Set([...collections, "*"])];
	const values = await useRedis().mget(names.map(scopedCacheEpochKey)).catch(() => []);
	return Object.fromEntries(names.map((name, index) => [name, values[index] ?? null]));
}
/**
* Bump the counters of the collections a purge just dropped tags for. Expiring, so
* a collection nothing writes to stops costing a key; a read whose counter expired
* between capture and fill reads `null` on both sides and caches, which is right —
* nothing purged it in between.
*/
async function bumpScopedCacheEpochs(collections) {
	if (!scopedCachePurgeEnabled() || !redisConfigAvailable()) return;
	const names = [...new Set(collections)];
	if (names.length === 0) return;
	try {
		const pipeline = useRedis().pipeline();
		for (const name of names) {
			pipeline.incr(scopedCacheEpochKey(name));
			pipeline.expire(scopedCacheEpochKey(name), SCOPED_CACHE_EPOCH_TTL_SECONDS);
		}
		await pipeline.exec();
	} catch {}
}
function scopedCacheCollectionSlicesKey(collection) {
	return `${env["CACHE_NAMESPACE"]}:slices:${collection}`;
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
*   - a DIRECT self-relation that only rewrites a foreign key is left out: the
*     surviving children stay in place carrying a slice this walk cannot name. The
*     delete purges those vacated slices precisely instead — see the collaborator's
*     `vacatedSelfRelationTags`, unioned into the delete's snapshot.
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
const SCOPED_CACHE_EPOCH_TTL_SECONDS = 1440 * 60;
/**
* File a key under a tag set and give that set an expiry that only ever moves OUT.
*
* A bare `EXPIRE` overwrites, and a tag set is SHARED by every entry pinned to that
* slice: lower `CACHE_TTL` at runtime and one short-lived write cuts short the set
* indexing an entry cached for an hour, leaving that entry unreachable to every
* purge for the rest of its life. Redis 7 has `EXPIRE … GT`, but GT reads a key
* carrying no TTL as infinite: it refuses the very first expiry a fresh tag set
* needs, and cannot tell that set from one deliberately left unbounded. So the
* comparison runs as a script — atomic, one pipeline slot, and `EXISTS` telling
* those two apart.
*
* A set that already carries NO expiry outlives every entry by construction, so it
* keeps none — only a freshly created set takes one unconditionally.
*/
const scopedCacheTagExpiryScript = `
local existed = redis.call('EXISTS', KEYS[1])
redis.call('SADD', KEYS[1], unpack(ARGV, 2))
local want = tonumber(ARGV[1])
if existed == 0 then
	redis.call('EXPIRE', KEYS[1], want)
	return 1
end
local ttl = redis.call('TTL', KEYS[1])
if ttl >= 0 and ttl < want then
	redis.call('EXPIRE', KEYS[1], want)
end
return 0
`;
/**
* Index a freshly-cached response key under every tag its data came from, so a later
* mutation can drop just the matching entries instead of the whole namespace. Both
* the payload key and its `__expires_at` sibling are tagged. When a cache TTL is
* set, each tag set self-expires at `SCOPED_CACHE_TAG_TTL_FACTOR` times that TTL, as
* a net for members orphaned by a crash between write and purge; with no TTL
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
		const members = [
			key,
			`${key}__expires_at`,
			...extraSiblings
		];
		if (ttlSeconds > 0) pipeline.eval(scopedCacheTagExpiryScript, 1, tagKey, ttlSeconds, ...members);
		else pipeline.sadd(tagKey, ...members);
		if (tag.field === void 0) continue;
		const slicesKey = scopedCacheCollectionSlicesKey(tag.collection);
		if (ttlSeconds > 0) pipeline.eval(scopedCacheTagExpiryScript, 1, slicesKey, ttlSeconds, tagKey);
		else pipeline.sadd(slicesKey, tagKey);
	}
	const failed = (await pipeline.exec())?.find(([error]) => error !== null);
	if (failed) throw failed[0];
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
* Delete the cache entries a set of tag keys point to, then drop the tag sets.
* Shared by the scoped purge (specific value slices) and the collection-wide
* fallback (every slice).
*
* Returns how many cache ENTRIES it actually deleted, which is neither how many keys
* it deleted nor how many the tag sets named.
*
* Not the key count, because a tag set holds each entry alongside its `__expires_at`
* sibling and any extra sibling (`__tags`), so counting members would report every
* entry twice over. A sidecar is recognisable by its base key being in the set
* beside it — the `sadd` writes them together — which stays right as siblings are
* added.
*
* Not the membership count either, because nothing ever SREMs: a member that expired
* by TTL stays named by the set until the set itself is dropped here. On the
* workload this fork exists for — per-user keys, so high cardinality, TTLs shorter
* than the gap between mutations — most of a set can be entries that were already
* gone, and counting them would inflate every purge figure on the page. So the
* store's own answer decides. Only an explicit `false` is evidence the key was
* absent; a store that reports nothing leaves the count where it was rather than
* silently collapsing it to zero.
*/
const SCOPED_CACHE_SIDECAR_SUFFIXES = ["__expires_at", "__tags"];
function scopedCacheSidecarOwner(member) {
	const suffix = SCOPED_CACHE_SIDECAR_SUFFIXES.find((candidate) => member.endsWith(candidate));
	return suffix === void 0 ? null : member.slice(0, -suffix.length);
}
/** The collection a tag key names, bare tag or value slice alike. */
function scopedCacheCollectionOfTagKey(tagKey) {
	const tagPrefix = `${env["CACHE_NAMESPACE"]}:tag:`;
	if (!tagKey.startsWith(tagPrefix)) return null;
	const label = tagKey.slice(tagPrefix.length);
	const fieldAt = label.indexOf(":");
	return fieldAt === -1 ? label : label.slice(0, fieldAt);
}
async function purgeScopedCacheTagKeys(cache, tagKeys) {
	if (tagKeys.length === 0) return 0;
	const redis = useRedis();
	await bumpScopedCacheEpochs(tagKeys.map(scopedCacheCollectionOfTagKey).filter((collection) => collection !== null));
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
* Cursor-scan every Redis key matching `match`. A single-node SCAN only covers the
* whole keyspace on a standalone client; a cluster would miss keys on other nodes.
* Scoped mode is refused on a cluster at startup
* (`assertScopedCacheRedisSupported`), so the client here is always standalone.
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
	await bumpScopedCacheEpochs(["*"]);
}
/**
* Purge every cached read of `collection` — its bare collection tag plus all its
* value slices — without full-flushing the namespace. The fallback when a mutation's
* scope values are unresolvable (e.g. an upsert mixing inserts and updates): which
* slices changed is unknown, but only reads touching THIS collection can be stale,
* so scope the flush to its tag sets and spare every other collection's entries.
*/
async function purgeCollectionScopedCache(cache, collection, scopedCachePurgeId) {
	const bareKey = `${env["CACHE_NAMESPACE"]}:tag:${collection}`;
	await bumpScopedCacheEpochs([collection]);
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
	const { getCache } = await import("../cache.js");
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
	import("../cache.js").then(({ getCache }) => {
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
	const { readCacheDescriptorForRedisKey } = await import("../cache-events.js");
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
* resolved" → fall back to a collection-wide purge (bare tag + every slice) rather
* than risk leaving a slice stale; still narrower than nuking the whole namespace.
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

//#endregion
export { assertScopedCacheRedisSupported, countScopedCacheTagMembers, dropScopedCacheTagIndex, purgeCollectionScopedCache, purgeScopedCache, readScopedCacheEpochs, retryPendingScopedCachePurges, scopedCacheCollectionsChangedByOnDelete, scopedCachePurgeEnabled, scopedCacheTagExpiryScript, startScopedCachePurgeRecovery, tagScopedCacheKeys };