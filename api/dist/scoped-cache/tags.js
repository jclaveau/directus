import { useEnv } from "@directus/env";

//#region src/scoped-cache/tags.ts
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
	const takenOverKeys = /* @__PURE__ */ new Set();
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
		takenOverKeys,
		scope: { scopeTo: (input, options) => add(input, options?.manuallyPurged) },
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
	if (type === "boolean") return value === true || value === 1 || value === "1" || value === "t" || value === "true" ? "true" : "false";
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
export { PIN_UNSAFE_SCOPE_TYPES, canonicalScopedCacheValue, createScopedCacheCollector, isPinnableScopeType, scopedCacheMaxPinsPerCollection, scopedCacheTagKey, scopedCacheTagLabel, scopedCacheTagsFromRows, serializeScopedCacheTags };