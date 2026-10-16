import { earlierScopedCacheEpoch, scopedCachePinKey } from "./pins.js";
import { renderScopedCacheFingerprint, scopedCacheDeclaredPins, scopedCacheFingerprintOf } from "./fingerprint.js";
import { getNodeEnv } from "@directus/utils/node";

//#region src/scoped-cache/hook-declarations.ts
/**
* The meta of every fulfilled lookup inside a `dependOn` argument. A read result is
* an array carrying a non-enumerable `getMeta`, so the rider is checked before the
* array shape: with it, the value is one lookup; without it, a batch to walk, whose
* entries are lookups or `allSettled` verdicts over them.
*/
function* readMetasOf(dependency) {
	if (dependency === null || typeof dependency !== "object") return;
	if (typeof dependency.getMeta === "function") {
		yield dependency.getMeta();
		return;
	}
	if (!Array.isArray(dependency)) return;
	for (const entry of dependency) {
		if (entry !== null && typeof entry === "object" && "status" in entry) {
			if (entry.status === "fulfilled") yield* readMetasOf(entry.value);
			continue;
		}
		yield* readMetasOf(entry);
	}
}
/**
* The per-operation sink backing the `context.scopedCache` hook handle. The
* service wires ONE of `scope`/`purgeHandleFor(collection)` as `context.scopedCache`
* per the filter event (read → `scope.scopeTo`, mutation → `purgeBy`, its
* `skipPurgeFor` recorded under that collection); the hook pushes via it and
* the service drains `scopeQueryCases` into the read's scope, `purgeFingerprints`
* into the mutation's purge. Both are idempotent sinks. Safe with purging off
* (then neither is read).
*/
function createScopedCacheHookDeclarations(schema) {
	const scopeQueryCases = [];
	const seenScopeQueryCases = /* @__PURE__ */ new Set();
	const manuallyPurgedKeys = /* @__PURE__ */ new Set();
	const epochs = {};
	const purgeSkippedKeys = /* @__PURE__ */ new Map();
	const purgeDeclaredKeys = /* @__PURE__ */ new Map();
	const takenOverKeys = /* @__PURE__ */ new Set();
	const purgeFingerprints = [];
	const seenPurgeFingerprints = /* @__PURE__ */ new Set();
	function add(input, manuallyPurged = false, declaredEpochs) {
		for (const [collection, epoch] of Object.entries(declaredEpochs ?? {})) epochs[collection] = collection in epochs ? earlierScopedCacheEpoch(epochs[collection], epoch) : epoch;
		const batch = Array.isArray(input) ? input : [input];
		for (const declared of batch) {
			const queryCase = scopedCacheDeclaredPins(declared, schema).map((pin) => ({
				...pin,
				collection: declared.collection
			}));
			const axes = queryCase.length > 0 ? queryCase : [{ collection: declared.collection }];
			if (manuallyPurged) for (const pin of axes) manuallyPurgedKeys.add(scopedCachePinKey(pin));
			const key = axes.map(scopedCachePinKey).sort().join("&");
			if (seenScopeQueryCases.has(key)) continue;
			seenScopeQueryCases.add(key);
			scopeQueryCases.push(axes);
		}
	}
	function missingScopeFieldsOf(declared) {
		const collectionSchema = schema.collections[declared.collection];
		if (!collectionSchema) return [];
		const pinnedFields = scopedCacheDeclaredPins(declared, schema).map((pin) => pin.field);
		return (collectionSchema.scopedCacheFields?.length ? collectionSchema.scopedCacheFields : [collectionSchema.primary]).filter((scopeField) => !pinnedFields.includes(scopeField));
	}
	function addPurgeFingerprint(eventCollection, input, forKey) {
		const batch = Array.isArray(input) ? input : [input];
		for (const declared of batch) {
			const missingScopeFields = forKey !== void 0 && declared.collection === eventCollection ? missingScopeFieldsOf(declared) : null;
			if (missingScopeFields !== null && missingScopeFields.length > 0 && (getNodeEnv() ?? "production") !== "production") {
				const missingNames = missingScopeFields.map((scopeField) => `"${scopeField}"`).join(", ");
				throw new Error(`purgeBy forKey ${forKey} on "${eventCollection}" must pin every scope field: missing ${missingNames}`);
			}
			if (missingScopeFields !== null && missingScopeFields.length === 0) {
				const declaredKeys = purgeDeclaredKeys.get(eventCollection) ?? /* @__PURE__ */ new Set();
				declaredKeys.add(String(forKey));
				purgeDeclaredKeys.set(eventCollection, declaredKeys);
			}
			const fingerprint = scopedCacheFingerprintOf(declared.collection, scopedCacheDeclaredPins(declared, schema));
			const key = renderScopedCacheFingerprint(fingerprint);
			if (seenPurgeFingerprints.has(key)) continue;
			seenPurgeFingerprints.add(key);
			purgeFingerprints.push(fingerprint);
		}
	}
	return {
		scopeQueryCases,
		purgeFingerprints,
		manuallyPurgedKeys,
		purgeSkippedKeys,
		purgeDeclaredKeys,
		takenOverKeys,
		epochs,
		scope: {
			scopeTo: (input, options) => {
				add(input, options?.manuallyPurged, options?.epochs);
			},
			dependOn: async (lookup) => {
				const resolved = await lookup;
				for (const meta of readMetasOf(resolved)) add(meta.scopedCacheFingerprints, false, meta.scopedCacheEpochs);
				return resolved;
			}
		},
		purgeHandleFor: (collection) => {
			return {
				purgeBy: (input, options) => {
					addPurgeFingerprint(collection, input, options?.forKey);
				},
				skipPurgeFor: (key) => {
					const skippedKeys = purgeSkippedKeys.get(collection) ?? /* @__PURE__ */ new Set();
					skippedKeys.add(String(key));
					purgeSkippedKeys.set(collection, skippedKeys);
				}
			};
		}
	};
}

//#endregion
export { createScopedCacheHookDeclarations };