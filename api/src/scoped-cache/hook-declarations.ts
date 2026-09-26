import type {
	MaybeWithMeta,
	ReadMeta,
	SchemaOverview,
	ScopedCacheCollectionPin,
	ScopedCacheDeclaredFingerprint,
	ScopedCacheDependency,
	ScopedCacheFingerprint,
	ScopedCacheFingerprintInput,
	ScopedCacheHookDeclarations,
	WithMeta,
} from '@directus/types';
import {
	renderScopedCacheFingerprint,
	scopedCacheDeclaredPins,
	scopedCacheFingerprintOf,
} from './fingerprint.js';
import { earlierScopedCacheEpoch, scopedCachePinKey } from './pins.js';

/**
 * The meta of every fulfilled lookup inside a `dependOn` argument. A read result is
 * an array carrying a non-enumerable `getMeta`, so the rider is checked before the
 * array shape: with it, the value is one lookup; without it, a batch to walk, whose
 * entries are lookups or `allSettled` verdicts over them.
 */
function* readMetasOf(dependency: ScopedCacheDependency): Generator<ReadMeta> {
	if (dependency === null || typeof dependency !== 'object') {
		return;
	}

	if (typeof (dependency as MaybeWithMeta<object>).getMeta === 'function') {
		yield (dependency as WithMeta<object>).getMeta();
		return;
	}

	if (!Array.isArray(dependency)) {
		return;
	}

	for (const entry of dependency) {
		if (entry !== null && typeof entry === 'object' && 'status' in entry) {
			if (entry.status === 'fulfilled') {
				yield* readMetasOf(entry.value);
			}

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
export function createScopedCacheHookDeclarations(
	schema: SchemaOverview,
): ScopedCacheHookDeclarations {
	const scopeQueryCases: ScopedCacheCollectionPin[][] = [];
	const seenScopeQueryCases = new Set<string>();
	const manuallyPurgedKeys = new Set<string>();
	const epochs: Record<string, string | null> = {};
	const purgeSkippedKeys = new Set<string>();
	const takenOverKeys = new Set<string>();
	const purgeFingerprints: ScopedCacheFingerprint[] = [];
	const seenPurgeFingerprints = new Set<string>();

	function add(
		input: ScopedCacheFingerprintInput,
		manuallyPurged = false,
		declaredEpochs?: Record<string, string | null>,
	): void {
		for (const [collection, epoch] of Object.entries(declaredEpochs ?? {})) {
			epochs[collection] = collection in epochs
				? earlierScopedCacheEpoch(epochs[collection], epoch)
				: epoch;
		}

		const batch = Array.isArray(input)
			? input
			: [input as ScopedCacheDeclaredFingerprint];

		for (const declared of batch) {
			// One query case per declared fingerprint: its axes typed off the schema,
			// kept together. A hook names a slice by field and value and rarely knows
			// the column's type, but the type is what canonicalizes the value — `uuid`
			// lowercases and `integer` strips a leading zero — so a type-less axis and
			// the schema-typed one the purge side emits would resolve DIFFERENT slices
			// of the SAME row.
			const queryCase = scopedCacheDeclaredPins(declared, schema)
				.map((pin) => ({ ...pin, collection: declared.collection }));

			// The values a read is pinned to are its own; a declared fingerprint
			// naming none is the collection whole, which is one axis pinning nothing.
			const axes = queryCase.length > 0
				? queryCase
				: [{ collection: declared.collection }];

			// Record the accept regardless of dedup: if ANY scopeTo of this axis marked
			// it manuallyPurged, it's exempt from the unautopurgeable-scope anomaly.
			if (manuallyPurged) {
				for (const pin of axes) {
					manuallyPurgedKeys.add(scopedCachePinKey(pin));
				}
			}

			// Idempotent: a hook looping over rows that resolve the same slice — or a
			// batch/upsert parent's shared declarations fed by many children — must not
			// inflate the set. Key on the canonical pin keys of the whole case, so
			// field order and value/type variants (7 vs '7') can't slip a duplicate
			// past a raw JSON compare.
			const key = axes
				.map(scopedCachePinKey)
				.sort()
				.join('&');

			if (seenScopeQueryCases.has(key)) {
				continue;
			}

			seenScopeQueryCases.add(key);
			scopeQueryCases.push(axes);
		}
	}

	function addPurgeFingerprint(
		input:
			| ScopedCacheDeclaredFingerprint
			| readonly ScopedCacheDeclaredFingerprint[],
	): void {
		const batch = Array.isArray(input)
			? input
			: [input as ScopedCacheDeclaredFingerprint];

		for (const declared of batch) {
			// View fields deliberately dropped: they name the columns a READ depends
			// on, and a purge is answered by the scope alone. Kept, two reads of one
			// slice through different columns would be two purges of the same thing.
			const fingerprint = scopedCacheFingerprintOf(
				declared.collection,
				scopedCacheDeclaredPins(declared, schema),
			);

			// Same idempotence the pin sink has, keyed on the serialised form — the
			// one the index is written in, so field order and value spelling cannot
			// slip a duplicate past a raw compare.
			const key = renderScopedCacheFingerprint(fingerprint);

			if (seenPurgeFingerprints.has(key)) {
				continue;
			}

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

				for (const meta of readMetasOf(resolved)) {
					add(meta.scopedCacheFingerprints, false, meta.scopedCacheEpochs);
				}

				return resolved;
			},
		},
		purge: {
			purgeBy: (input) => addPurgeFingerprint(input),
			// Deliberately not a fingerprint: the take-over check reads how many were
			// declared, and declaring nothing to purge must not read as declaring a
			// purge.
			skipPurgeFor: (key) => {
				purgeSkippedKeys.add(String(key));
			},
		},
	};
}
