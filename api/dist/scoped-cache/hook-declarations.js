import { earlierScopedCacheEpoch, scopedCachePinKey } from "./pins.js";
import { renderScopedCacheFingerprint, scopedCacheDeclaredPins, scopedCacheFingerprintOf } from "./fingerprint.js";

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
* service wires ONE of `scope`/`purge` as `context.scopedCache` per the filter event
* (read → `scope.scopeTo`, mutation → `purge.purgeBy`); the hook pushes via it and
* the service drains `scopeQueryCases` into the read's scope, `purgeFingerprints`
* into the mutation's purge. Both are idempotent sinks. Safe with purging off
* (then neither is read).
*/
function createScopedCacheHookDeclarations(schema) {
	const scopeQueryCases = [];
	const seenScopeQueryCases = /* @__PURE__ */ new Set();
	const manuallyPurgedKeys = /* @__PURE__ */ new Set();
	const epochs = {};
	const purgeSkippedKeys = /* @__PURE__ */ new Set();
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
	function addPurgeFingerprint(input) {
		const batch = Array.isArray(input) ? input : [input];
		for (const declared of batch) {
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
		purge: {
			purgeBy: (input) => addPurgeFingerprint(input),
			skipPurgeFor: (key) => {
				purgeSkippedKeys.add(String(key));
			}
		}
	};
}

//#endregion
export { createScopedCacheHookDeclarations };