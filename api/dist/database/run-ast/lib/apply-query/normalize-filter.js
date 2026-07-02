import { isObject } from "@directus/utils";

//#region src/database/run-ast/lib/apply-query/normalize-filter.ts
/**
* Normalizes a filter so that each relational path segment has at most one
* non-operator child key. When a relational object has multiple sibling
* children (e.g. `{ parent: { field_a: { _eq: 'value' }, nested: { ... } } }`),
* they are split into separate entries wrapped in `_and`.
*
* This is necessary because `getFilterPath` only follows `Object.keys(value)[0]`,
* silently dropping any sibling keys at the same nesting level.
*/
function normalizeFilter(filter) {
	const entries = Object.entries(filter);
	const parts = [];
	for (const [key, value] of entries) {
		if (key === "_and" || key === "_or") {
			parts.push({ [key]: value.map((f) => normalizeFilter(f)) });
			continue;
		}
		if (!isObject(value)) {
			parts.push({ [key]: value });
			continue;
		}
		const val = value;
		const childKeys = Object.keys(val);
		const relKeys = childKeys.filter((k) => !k.startsWith("_") || k === "_none" || k === "_some");
		const opKeys = childKeys.filter((k) => k.startsWith("_") && k !== "_none" && k !== "_some");
		if (relKeys.length > 1 || relKeys.length >= 1 && opKeys.length >= 1) {
			for (const rk of relKeys) liftAndPush(parts, key, normalizeFilter({ [rk]: val[rk] }));
			if (opKeys.length > 0) {
				const ops = {};
				for (const ok of opKeys) ops[ok] = val[ok];
				parts.push({ [key]: ops });
			}
		} else if (relKeys.length === 1) liftAndPush(parts, key, normalizeFilter(val));
		else parts.push({ [key]: val });
	}
	if (parts.length === 0) return {};
	if (parts.length === 1) return parts[0];
	const allKeys = parts.flatMap((p) => Object.keys(p));
	if (new Set(allKeys).size === allKeys.length) return Object.assign({}, ...parts);
	return { _and: parts };
}
/**
* If the normalized result is a pure `_and` wrapper, lift each sub-filter
* and wrap it with the parent key individually. This prevents `_and` from
* appearing inside a relational value object where `getFilterPath` can't
* handle it.
*/
function liftAndPush(parts, key, normalized) {
	const normKeys = Object.keys(normalized);
	if (normKeys.length === 1 && normKeys[0] === "_and") for (const sub of normalized._and) parts.push({ [key]: sub });
	else parts.push({ [key]: normalized });
}

//#endregion
export { normalizeFilter };