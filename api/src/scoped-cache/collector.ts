import type {
	MaybeWithMeta,
	ReadMeta,
	SchemaOverview,
	ScopedCacheCollector,
	ScopedCacheDeclaredFingerprint,
	ScopedCacheDependency,
	ScopedCacheFingerprint,
	ScopedCacheCollectionPin,
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
 * A per-operation collector backing the `context.scopedCache` hook handle. The
 * service wires ONE of `scope`/`purge` as `context.scopedCache` per the filter event
 * (read → `scope.scopeTo`, mutation → `purge.purgeBy`); the hook pushes via it and
 * the service drains `pins` into the read's scope, `purgeFingerprints` into the
 * mutation's purge. Both are idempotent sinks. Safe with purging off (then neither
 * is read).
 */
export function createScopedCacheCollector(
	schema: SchemaOverview,
): ScopedCacheCollector {
	const pins: ScopedCacheCollectionPin[] = [];
	const seen = new Set<string>();
	const manuallyPurgedKeys = new Set<string>();
	const epochs: Record<string, string | null> = {};
	const purgeSkippedKeys = new Set<string>();
	const takenOverKeys = new Set<string>();
	const purgeFingerprints: ScopedCacheFingerprint[] = [];
	const seenPurgeFingerprints = new Set<string>();

	// A hook names a slice by collection/field/value and rarely knows the column's
	// type, but the type is what canonicalizes the value: `uuid` lowercases and
	// `integer` strips a leading zero, so a type-less pin and the schema-typed one
	// the purge side emits resolve DIFFERENT keys for the SAME row — a pin nothing
	// ever purges. Fill it from the schema so both sides agree.
	function withSchemaType(pin: ScopedCacheCollectionPin): ScopedCacheCollectionPin {
		if (pin.type !== undefined || pin.field === undefined) {
			return pin;
		}

		const schemaType = schema.collections[pin.collection]?.fields[pin.field]?.type;

		return schemaType === undefined
			? pin
			: { ...pin, type: schemaType };
	}

	function add(
		input: ScopedCacheCollectionPin | readonly ScopedCacheCollectionPin[],
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
			: [input];

		for (const declaredPin of batch) {
			const pin = withSchemaType(declaredPin);

			// Idempotent: a hook looping over rows that resolve the same slice — or a
			// batch/upsert parent's shared collector fed by many children — must not
			// inflate the set. Key on the canonical pin key (the same one the purge side
			// dedups on), so field order and value/type variants (7 vs '7') can't slip a
			// duplicate past a raw JSON compare.
			const key = scopedCachePinKey(pin);

			// Record the accept regardless of dedup: if ANY scopeTo of this pin marked it
			// manuallyPurged, it's exempt from the unautopurgeable-scope anomaly.
			if (manuallyPurged) {
				manuallyPurgedKeys.add(key);
			}

			if (seen.has(key)) {
				continue;
			}

			seen.add(key);
			pins.push(pin);
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
		pins,
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
					add(meta.scopedCacheTags, false, meta.scopedCacheEpochs);
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
