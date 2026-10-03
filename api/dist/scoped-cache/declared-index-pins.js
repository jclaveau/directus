import { useLogger } from "../logger/index.js";
import { scopedCacheFingerprintIsBare } from "./fingerprint.js";

//#region src/scoped-cache/declared-index-pins.ts
/**
* How many keys a declared purge reads back before it reads its collection's index
* whole instead: one index chunk's worth.
*/
const SCOPED_CACHE_READ_BACK_KEYS = 500;
/** The token `canonicalizeScopedCachePinValue` spells a null as. */
const SCOPED_CACHE_NULL_TOKEN = "\0null";
function pinnedTokensAt(fingerprint, field) {
	const pinnedScope = fingerprint.pinnedScope ?? {};
	return Object.hasOwn(pinnedScope, field) ? pinnedScope[field] : [];
}
/**
* The declared pins, each also pinned to the index path's values its relation
* reaches — what the store reads instead of every set the collection owns — or
* `null` when those values cannot be read back, and the store has to.
*
* Only for a pin on the index path's first hop: `student_course_id=7` under
* `student_course_id.teaching_unit.owner` reads `teaching_unit.owner` off
* `student_courses` row 7. The value at the path's end is reached THROUGH the
* key, so it is a function of the key alone, never of the rows holding it: a row
* that moved off 7, or was deleted, cannot hide a value an entry holding it was
* filed under. A pin on any other field could only be read back through the rows
* holding it now — which a moved row no longer is.
*
* That function is read after the mutation committed, so a mutation of a
* collection the path walks through — `student_courses` or `teaching_units` — may
* have just changed it, and the value an entry was filed under is gone: the store
* reads the index whole for that one. So does a collection the database changed
* under the mutation, as a delete's `SET NULL` rewrites `teaching_units.owner`.
*
* What it returns is what the store scans, never what the purge matches: the
* match still tests the pins as declared. A bare pin is left out of it, since the
* entries it reaches pin nothing, and every other pin reaches those too.
*/
async function scopedCacheDeclaredIndexPins(schema, knex, collection, declared, indexPath, mutatedCollections) {
	const [hopField, ...terminalSegments] = indexPath?.split(".") ?? [];
	if (indexPath === null || hopField === void 0) return null;
	const walkedCollections = [];
	for (const segment of [hopField, ...terminalSegments.slice(0, -1)]) {
		const walkedFrom = walkedCollections.at(-1) ?? collection;
		const reachedCollection = schema.relations.find((relation) => {
			return relation.collection === walkedFrom && relation.field === segment;
		})?.related_collection;
		if (!reachedCollection || mutatedCollections.includes(reachedCollection)) return null;
		walkedCollections.push(reachedCollection);
	}
	const [relatedCollection] = walkedCollections;
	const relatedPrimaryKey = relatedCollection ? schema.collections[relatedCollection]?.primary : void 0;
	if (!relatedCollection || relatedPrimaryKey === void 0) return null;
	const readBackKeys = /* @__PURE__ */ new Set();
	for (const fingerprint of declared) {
		if (scopedCacheFingerprintIsBare(fingerprint) || pinnedTokensAt(fingerprint, indexPath).length > 0) continue;
		const hopTokens = pinnedTokensAt(fingerprint, hopField);
		if (hopTokens.length === 0) return null;
		for (const hopToken of hopTokens) readBackKeys.add(hopToken);
	}
	if (readBackKeys.size === 0 || readBackKeys.size > SCOPED_CACHE_READ_BACK_KEYS || readBackKeys.has(SCOPED_CACHE_NULL_TOKEN)) return null;
	let snapshot;
	try {
		const { ItemScopedCacheService } = await import("./item-scoped-cache-service.js");
		snapshot = await new ItemScopedCacheService(relatedCollection, schema, knex, null, null).snapshot([...readBackKeys]);
	} catch (error) {
		useLogger().warn(error, `[scoped-cache] a declared pin on ${collection}.${hopField} could not be read back, reading its index whole: ${error}`);
		return null;
	}
	if (snapshot.canResolveSlicesFromRows === false) return null;
	const terminalPath = terminalSegments.join(".");
	const terminalTokensByKey = /* @__PURE__ */ new Map();
	for (const { fingerprint } of snapshot.rows) {
		const [keyToken] = pinnedTokensAt(fingerprint, relatedPrimaryKey);
		const terminalTokens = pinnedTokensAt(fingerprint, terminalPath);
		if (keyToken === void 0 || terminalTokens.length === 0) return null;
		terminalTokensByKey.set(keyToken, terminalTokens);
	}
	const scannedPins = [];
	for (const fingerprint of declared) {
		if (scopedCacheFingerprintIsBare(fingerprint)) continue;
		if (pinnedTokensAt(fingerprint, indexPath).length > 0) {
			scannedPins.push(fingerprint);
			continue;
		}
		const terminalTokens = /* @__PURE__ */ new Set();
		for (const hopToken of pinnedTokensAt(fingerprint, hopField)) {
			const reachedTokens = terminalTokensByKey.get(hopToken);
			if (reachedTokens === void 0) return null;
			for (const reachedToken of reachedTokens) terminalTokens.add(reachedToken);
		}
		scannedPins.push({
			...fingerprint,
			pinnedScope: {
				...fingerprint.pinnedScope,
				[indexPath]: [...terminalTokens]
			}
		});
	}
	return scannedPins;
}

//#endregion
export { scopedCacheDeclaredIndexPins };