import type { Filter } from '@directus/types';
import { isObject } from '@directus/utils';

/**
 * Normalizes a filter so that each relational path segment has at most one
 * non-operator child key. When a relational object has multiple sibling
 * children (e.g. `{ parent: { field_a: { _eq: 'value' }, nested: { ... } } }`),
 * they are split into separate entries wrapped in `_and`.
 *
 * This is necessary because `getFilterPath` only follows `Object.keys(value)[0]`,
 * silently dropping any sibling keys at the same nesting level.
 *
 * Any object left with several sibling conditions comes back as `{ _and: [...] }`
 * — the same shape `parseFilter` produces for REST input — so the two paths agree
 * on what siblings mean wherever the result lands, `_or` elements included.
 */
export function normalizeFilter(filter: Filter): Filter {
	const entries = Object.entries(filter);
	const parts: Filter[] = [];

	for (const [key, value] of entries) {
		if (key === '_and' || key === '_or') {
			parts.push({ [key]: (value as Filter[]).map((f) => normalizeFilter(f)) } as Filter);
			continue;
		}

		if (!isObject(value)) {
			parts.push({ [key]: value } as Filter);
			continue;
		}

		const val = value as Record<string, any>;
		const childKeys = Object.keys(val);
		const relKeys = childKeys.filter((k) => !k.startsWith('_') || k === '_none' || k === '_some');
		const logicalKeys = childKeys.filter((k) => k === '_and' || k === '_or');

		const opKeys = childKeys.filter((k) => {
			return k.startsWith('_') && !['_none', '_some', '_and', '_or'].includes(k);
		});

		// A logical operator under a relational key is lifted above it, so
		// `{ rel: { _or: [a, b] } }` becomes `{ _or: [{ rel: a }, { rel: b }] }`. Left
		// in place it is not merely mis-combined, it is DROPPED: `getFilterPath` stops
		// at the `_or`, `getOperation` recurses in and returns null, and the clause
		// is skipped — the filter compiles to a bare `select *`. `parseFilter`
		// does this same lift (`shiftLogicalOperatorsUp`), which is why REST never
		// sees it and only the programmatic path could.
		for (const lk of logicalKeys) {
			const lifted = (val[lk] as Filter[]).map((sub) => {
				return normalizeFilter({ [key]: sub } as Filter);
			});

			parts.push({ [lk]: lifted } as Filter);
		}

		if (relKeys.length > 1 || (relKeys.length >= 1 && opKeys.length >= 1)) {
			// Multiple relational children or mix of relational + operator keys: split each
			for (const rk of relKeys) {
				const normalized = normalizeFilter({ [rk]: val[rk] } as Filter);
				liftAndPush(parts, key, normalized);
			}

			for (const ok of opKeys) {
				parts.push({ [key]: { [ok]: val[ok] } } as Filter);
			}
		}
		else if (relKeys.length === 1) {
			// Single relational child, recurse to normalize deeper levels
			const relKey = relKeys[0]!;
			liftAndPush(parts, key, normalizeFilter({ [relKey]: val[relKey] } as Filter));
		}
		else if (opKeys.length > 0) {
			// One part per operator. Several on one field cannot share a part:
			// `getOperation` reads `Object.keys(value)[0]` and returns that operator
			// alone, so `{ id: { _gte: 1, _lte: 10 } }` compiled to `id >= 1` and the
			// `_lte` was dropped. `parseFilter` splits them the same way.
			for (const ok of opKeys) {
				parts.push({ [key]: { [ok]: val[ok] } } as Filter);
			}
		}
	}

	if (parts.length === 0) return {} as Filter;
	if (parts.length === 1) return parts[0]!;

	// Always `_and`, mirroring `parseFilter`. Merging unique keys back into one flat
	// object reads as harmless — sibling keys are ANDed — but `addWhereClauses`
	// recurses `_or` elements with `logical = 'or'`, so a flat element's siblings
	// would be OR-combined. REST is safe because `parseFilter` wrapped it already;
	// this is the programmatic `readByQuery` path (#325).
	return { _and: parts } as Filter;
}

/**
 * Keep a logical wrapper from ending up inside a relational value, where
 * `getFilterPath` stops at it and `getOperation` returns null — which makes
 * `addWhereClauses` skip the clause entirely.
 *
 * `_and` distributes: each sub-filter becomes its own part under `key`, since the
 * parts are themselves `_and`-combined. `_or` cannot — its alternatives have to stay
 * one clause — so it is lifted whole with `key` pushed inside each alternative,
 * exactly as `shiftLogicalOperatorsUp` does in `parseFilter`.
 */
function liftAndPush(parts: Filter[], key: string, normalized: Filter): void {
	const normKeys = Object.keys(normalized);

	if (normKeys.length === 1 && normKeys[0] === '_and') {
		for (const sub of (normalized as any)._and) {
			parts.push({ [key]: sub } as Filter);
		}
	}
	else if (normKeys.length === 1 && normKeys[0] === '_or') {
		parts.push({
			_or: ((normalized as any)._or as Filter[]).map((sub) => ({ [key]: sub })),
		} as Filter);
	} else {
		parts.push({ [key]: normalized } as Filter);
	}
}
