import { useEnv } from "@directus/env";

//#region src/scoped-cache/tags.ts
const env = useEnv();
/**
* Of two readings of one collection's purge counter, the one taken EARLIER.
*
* Merging captures cannot be "whichever arrived first". Reads that contribute them
* run concurrently — GraphQL resolves its root fields in parallel, and a hook can
* fan its dependency lookups out with `allSettled` — so arrival order is not capture
* order. Keep the later of two and a purge that landed between them compares equal
* at fill time and the response is cached already stale, which is the whole thing
* the counters exist to catch.
*
* Absent beats every count: a counter that did not exist yet is the earliest reading
* there is, and any number later on proves a purge created it in between. A value
* that will not parse is treated the same way — `INCR` cannot produce one, so it
* means something is wrong, and the direction that fails toward not caching is the
* one to take.
*/
function earlierScopedCacheEpoch(left, right) {
	if (left === null || left === void 0 || right === null || right === void 0) return null;
	const leftCount = Number(left);
	const rightCount = Number(right);
	if (Number.isNaN(leftCount) || Number.isNaN(rightCount)) return null;
	return leftCount <= rightCount ? left : right;
}
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
	const epochs = {};
	const purgeSkippedKeys = /* @__PURE__ */ new Set();
	const takenOverKeys = /* @__PURE__ */ new Set();
	function withSchemaType(tag) {
		if (tag.type !== void 0 || tag.field === void 0) return tag;
		const schemaType = schema.collections[tag.collection]?.fields[tag.field]?.type;
		return schemaType === void 0 ? tag : {
			...tag,
			type: schemaType
		};
	}
	function add(input, manuallyPurged = false, declaredEpochs) {
		for (const [collection, epoch] of Object.entries(declaredEpochs ?? {})) epochs[collection] = collection in epochs ? earlierScopedCacheEpoch(epochs[collection], epoch) : epoch;
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
		takenOverKeys,
		epochs,
		scope: { scopeTo: (input, options) => {
			add(input, options?.manuallyPurged, options?.epochs);
		} },
		purge: {
			purgeBy: (input) => add(input),
			skipPurgeFor: (key) => {
				purgeSkippedKeys.add(String(key));
			}
		}
	};
}
function canonicalScopedCacheValue(value, type) {
	if (value === null || value === void 0) return "\0null";
	if (type === "boolean") {
		const spelling = String(value).toLowerCase();
		return value === true || value === 1 || [
			"1",
			"t",
			"true",
			"y",
			"yes",
			"on"
		].includes(spelling) ? "true" : "false";
	}
	if (type === "date" || type === "dateTime" || type === "timestamp") {
		const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
		return Number.isNaN(ms) ? String(value) : String(ms);
	}
	if (type === "uuid") return String(value).toLowerCase();
	if (type === "string" || type === "text") return String(value).toLowerCase();
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
/**
* How a row a create hook took over is named in the collector's set. Recorded
* where the take-over happens and read back in another method entirely, so the
* two spellings have to come from one place or the lookup silently misses.
*/
function takenOverScopedCacheKey(collection, key) {
	return `${collection}:${String(key)}`;
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

//#endregion
export { PIN_UNSAFE_SCOPE_TYPES, canonicalScopedCacheValue, createScopedCacheCollector, earlierScopedCacheEpoch, isPinnableScopeType, scopedCacheMaxPinsPerCollection, scopedCacheTagKey, scopedCacheTagLabel, scopedCacheTagsFromRows, serializeScopedCacheTags, takenOverScopedCacheKey };