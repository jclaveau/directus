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
		const opKeys = childKeys.filter((k) => k.startsWith('_') && k !== '_none' && k !== '_some');

		if (relKeys.length > 1 || (relKeys.length >= 1 && opKeys.length >= 1)) {
			// Multiple relational children or mix of relational + operator keys: split each
			for (const rk of relKeys) {
				const normalized = normalizeFilter({ [rk]: val[rk] } as Filter);
				liftAndPush(parts, key, normalized);
			}

			if (opKeys.length > 0) {
				const ops: Record<string, any> = {};
				for (const ok of opKeys) ops[ok] = val[ok];
				parts.push({ [key]: ops } as Filter);
			}
		} else if (relKeys.length === 1) {
			// Single relational child, recurse to normalize deeper levels
			const normalized = normalizeFilter(val as Filter);
			liftAndPush(parts, key, normalized);
		} else {
			// Only operator keys (leaf node)
			parts.push({ [key]: val } as Filter);
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
 * If the normalized result is a pure `_and` wrapper, lift each sub-filter
 * and wrap it with the parent key individually. This prevents `_and` from
 * appearing inside a relational value object where `getFilterPath` can't
 * handle it.
 */
function liftAndPush(parts: Filter[], key: string, normalized: Filter): void {
	const normKeys = Object.keys(normalized);

	if (normKeys.length === 1 && normKeys[0] === '_and') {
		for (const sub of (normalized as any)._and) {
			parts.push({ [key]: sub } as Filter);
		}
	} else {
		parts.push({ [key]: normalized } as Filter);
	}
}
