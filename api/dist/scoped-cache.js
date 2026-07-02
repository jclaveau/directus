import { getMilliseconds } from "./utils/get-milliseconds.js";
import { useRedis } from "./redis/lib/use-redis.js";
import { redisConfigAvailable } from "./redis/utils/redis-config-available.js";
import "./redis/index.js";
import emitter_default from "./emitter.js";
import { useEnv } from "@directus/env";

//#region src/scoped-cache.ts
const env = useEnv();
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
function scopedCacheTagKey(tag) {
	const base = `${env["CACHE_NAMESPACE"]}:tag:${tag.collection}`;
	return tag.field === void 0 ? base : `${base}:${tag.field}=${canonicalScopedCacheValue(tag.value, tag.type)}`;
}
/**
* Index a freshly-cached response key under every tag its data came from, so a later
* mutation can drop just the matching entries instead of the whole namespace. Both the
* payload key and its `__expires_at` sibling are tagged. When a cache TTL is set, each tag
* set self-expires at twice that TTL as a safety net against members orphaned by a crash
* between write and purge; with no TTL (`CACHE_TTL` unset) the cached entries never expire
* either, so the tag sets are left unbounded to match — a normal purge still drains them.
*/
async function tagScopedCacheKeys(key, scopedCacheTags) {
	if (!scopedCachePurgeEnabled()) return;
	const tagKeys = [...new Set([...scopedCacheTags].map(scopedCacheTagKey))];
	if (tagKeys.length === 0) return;
	const redis = useRedis();
	const ttlSeconds = Math.ceil(getMilliseconds(env["CACHE_TTL"], 0) / 1e3) * 2;
	const pipeline = redis.pipeline();
	for (const tagKey of tagKeys) {
		pipeline.sadd(tagKey, key, `${key}__expires_at`);
		if (ttlSeconds > 0) pipeline.expire(tagKey, ttlSeconds);
	}
	await pipeline.exec();
}
/**
* Delete the cache entries a set of tag keys point to, then drop the tag sets. Shared by
* the scoped purge (specific value slices) and the collection-wide fallback (every slice).
*/
async function purgeScopedCacheTagKeys(cache, tagKeys) {
	if (tagKeys.length === 0) return;
	const redis = useRedis();
	const memberLists = await Promise.all(tagKeys.map((tagKey) => redis.smembers(tagKey)));
	const members = [...new Set(memberLists.flat())];
	if (members.length > 0) await Promise.all(members.map((member) => cache.delete(member)));
	await redis.del(...tagKeys);
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
* Purge every cached read of `collection` — its bare collection tag plus all its value
* slices — without full-flushing the namespace. The fallback when a mutation's scope
* values are unresolvable (e.g. an upsert mixing inserts and updates): which slices
* changed is unknown, but only reads touching THIS collection can be stale, so scope the
* flush to its tag sets and spare every other collection's entries.
*/
async function purgeCollectionScopedCache(cache, collection) {
	const bareKey = `${env["CACHE_NAMESPACE"]}:tag:${collection}`;
	await purgeScopedCacheTagKeys(cache, [bareKey, ...await scanScopedCacheTagKeys(`${bareKey}:*`)]);
}
/**
* Purge cached responses affected by a mutation on `collection`. Outside scoped mode
* the whole data cache is flushed (legacy `cache.clear()` behavior). In scoped mode
* the bare collection tag (global reads) is always purged alongside the resolved
* `scopedCacheTags` (the owner/partition slices the mutation touched), leaving every
* other slice untouched. A `null` `scopedCacheTags` means "values couldn't be
* resolved" → fall back to a collection-wide purge (bare tag + every slice) rather than
* risk leaving a slice stale; still narrower than nuking the whole namespace.
*/
async function purgeScopedCache(cache, collection, scopedCacheTags = [], context = null) {
	if (!scopedCachePurgeEnabled()) {
		await cache.clear();
		return;
	}
	if (scopedCacheTags === null) {
		await purgeCollectionScopedCache(cache, collection);
		return;
	}
	const resolvedScopedCacheTags = await emitter_default.emitFilter("cache.purge", [{ collection }, ...scopedCacheTags], { collection }, context);
	await purgeScopedCacheTagKeys(cache, [...new Set(resolvedScopedCacheTags.map(scopedCacheTagKey))]);
}
/**
* Build scoped cache tags from the distinct scope values present across `rows` — the purge side.
*
* - `onUnresolvable`: what to do when a row is missing a scoped-cache-field *key*. `'coarse'`
*   returns `null` so the caller can fall back to a collection-wide purge rather than leave a
*   slice stale; `'skip'` best-effort skips just that row's contribution.
* - The `'coarse'` path only triggers for a caller feeding *unprojected* rows (e.g. a raw payload).
*   The sole production caller (`snapshotScopedCacheTags`) reads rows via an explicit projected
*   `select`, so every field key is always present and it never returns `null` there — an
*   update/delete/create snapshot always resolves. A create whose committed rows can't be trusted
*   is caught upstream by the row-count check (`someRowTakenOver`), not here.
* - `fieldTypes`: each field's schema type, so the tag value canonicalizes the same way the read
*   side's filter value does.
*/
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
* Scope a read's root cache tags off the query filter — the read side. A read is
* soundly scoped to a value slice only when the filter *bounds* it to that value: a
* future insert with a new scope value must be excluded by the same filter, or the
* read would silently miss it (a write to the new value purges only its own slice,
* never this read). So scope tags come from `_eq`/`_in` constraints on a scoped cache
* field, reached through the root or an `_and` (an `_or` branch doesn't bound — a row
* matching the other branch still belongs). No pinned field → returns `[]`, and the
* caller falls back to the bare collection tag so every write to the collection
* invalidates the read. `fieldTypes` carries each field's schema type so the pinned
* filter value canonicalizes the same way the purge side's stored row value does — and
* so date-ish types (not pin-safe, see `PIN_UNSAFE_SCOPE_TYPES`) are skipped.
*/
function pinnedScopedCacheTagsFromFilter(collection, fields, filter, fieldTypes = {}) {
	if (!filter || fields.length === 0) return [];
	const fieldSet = new Set(fields);
	const pinned = /* @__PURE__ */ new Map();
	function pin(field, values) {
		const seen = pinned.get(field) ?? /* @__PURE__ */ new Set();
		for (const value of values) seen.add(value);
		pinned.set(field, seen);
	}
	function walk(node) {
		for (const [key, value] of Object.entries(node)) {
			if (key === "_and" && Array.isArray(value)) {
				for (const sub of value) walk(sub);
				continue;
			}
			if (key === "_or" || !fieldSet.has(key) || !isPinnableScopeType(fieldTypes[key]) || value === null || typeof value !== "object") continue;
			const ops = value;
			if ("_eq" in ops) pin(key, [ops["_eq"]]);
			else if ("_in" in ops && Array.isArray(ops["_in"])) pin(key, ops["_in"]);
		}
	}
	walk(filter);
	const tags = [];
	for (const [field, values] of pinned) for (const value of values) tags.push({
		collection,
		field,
		value,
		type: fieldTypes[field]
	});
	return tags;
}

//#endregion
export { assertScopedCacheRedisSupported, canonicalScopedCacheValue, pinnedScopedCacheTagsFromFilter, purgeCollectionScopedCache, purgeScopedCache, scopedCachePurgeEnabled, scopedCacheTagsFromRows, tagScopedCacheKeys };