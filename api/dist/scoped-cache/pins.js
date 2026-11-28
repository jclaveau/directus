import { cacheSetting } from "../cache-settings.js";
import { useEnv } from "@directus/env";

//#region src/scoped-cache/pins.ts
const env = useEnv();
/**
* Of two readings of one collection's purge counter, the one taken EARLIER.
*
* Merging snapshots cannot be "whichever arrived first". Reads that contribute them
* run concurrently — GraphQL resolves its root fields in parallel, and a hook can
* fan its dependency lookups out with `allSettled` — so arrival order is not
* snapshot order. Keep the later of two and a purge that landed between them
* compares equal at fill time and the response is cached already stale, which is
* the whole thing the counters exist to catch.
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
function canonicalizeScopedCachePinValue(value, type) {
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
* How a row a create hook took over is named in the hook declarations' set. Recorded
* where the take-over happens and read back in another method entirely, so the
* two spellings have to come from one place or the lookup silently misses.
*/
function takenOverScopedCacheKey(collection, key) {
	return `${collection}:${String(key)}`;
}
/**
* What identifies a pin: its collection, its field, and the value canonicalized —
* so `7` and `'7'`, `TRUE` and `t` key one slice. Every set that dedups pins keys
* on this, and nothing else, so two spellings of one slice cannot both be carried.
*
* No Redis prefix on it: the index is keyed by fingerprint, and a pin is only ever
* an identity in memory.
*/
function scopedCachePinKey(pin) {
	if (pin.field === void 0) return pin.collection;
	return `${pin.collection}:${pin.field}=${canonicalizeScopedCachePinValue(pin.value, pin.type)}`;
}
function scopedCacheCollectionPinsFromRows(collection, fields, rows, onUnresolvable, fieldTypes = {}) {
	const pins = [];
	for (const field of fields) {
		const seen = /* @__PURE__ */ new Set();
		for (const row of rows) {
			if (!(field in row)) {
				if (onUnresolvable === "coarse") return null;
				continue;
			}
			const value = row[field];
			const token = canonicalizeScopedCachePinValue(value, fieldTypes[field]);
			if (seen.has(token)) continue;
			seen.add(token);
			pins.push({
				collection,
				field,
				value,
				type: fieldTypes[field]
			});
		}
	}
	return pins;
}
/**
* How many slices one nested collection may pin on a single read. Every pin costs
* a set in the store plus a fingerprint index member, and the write side deletes
* them one by one.
*
* Sized from the fill a pin costs, measured by `tests/perf/pin-fanout.perf.test.ts`
* (#392): its read pinning 200 parents added 435 Redis commands over an uncached
* read at 250, and 8 at 64, where it falls back to the parents' slices or to the
* bare collection. What that buys back is on the write: over 1600 such reads
* cached, one parent's update evicted 153 of them pinned by key, 200 through a
* slice, and all 1600 through the bare collection. Every cap from 4 to 64
* measured the same fill. Which side is worth paying depends on the traffic, so
* the default keeps the key pins of a 200-row page and the cache page moves it.
*
* NOT the bound a purge's record is held to, though both coarsen rather than fan
* out and both fail toward over-purge: that one is forced by Postgres's 65 535
* bind parameters and wipes a whole collection's cache above it. This one only
* costs the one response its pin, which is still cached.
*
* Operator-tunable, live from the cache page for every node, because the right
* number is deployment-specific: it weighs what a fill costs Redis against how
* many entries a write evicts, and a pin costs one set plus a member of the
* collection's fingerprint index (130 B measured, on a TTL every write
* refreshes). No setting of it can serve a stale row.
*/
function scopedCacheMaxPinsPerCollection() {
	return cacheSetting("scoped_max_pins_per_collection");
}
/**
* How many ways to satisfy one filter are carried apart before they are carried
* side by side instead. A filter ANDing two `_in`s of ten values each has a
* hundred pairings, and an entry filed under a hundred index members costs a
* hundred writes to file and a hundred compares to purge — for a precision no
* read of that shape needs.
*
* Operator-tunable beside the pin ceiling above, and weighing the same two
* things: over it the read is pinned to each value on its own, which purges
* wider and never staler. Raise it for hit ratio, lower it for memory.
*/
function scopedCacheMaxQueryCases() {
	return env["CACHE_SCOPED_MAX_QUERY_CASES"];
}

//#endregion
export { PIN_UNSAFE_SCOPE_TYPES, canonicalizeScopedCachePinValue, earlierScopedCacheEpoch, isPinnableScopeType, scopedCacheCollectionPinsFromRows, scopedCacheMaxPinsPerCollection, scopedCacheMaxQueryCases, scopedCachePinKey, takenOverScopedCacheKey };