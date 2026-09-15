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
*
* Any object left with several sibling conditions comes back as `{ _and: [...] }`
* — the same shape `parseFilter` produces for REST input — so the two paths agree
* on what siblings mean wherever the result lands, `_or` elements included.
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
		const logicalKeys = childKeys.filter((k) => k === "_and" || k === "_or");
		const opKeys = childKeys.filter((k) => {
			return k.startsWith("_") && ![
				"_none",
				"_some",
				"_and",
				"_or"
			].includes(k);
		});
		for (const lk of logicalKeys) {
			const lifted = val[lk].map((sub) => {
				return normalizeFilter({ [key]: sub });
			});
			parts.push({ [lk]: lifted });
		}
		if (relKeys.length > 1 || relKeys.length >= 1 && opKeys.length >= 1) {
			for (const rk of relKeys) liftAndPush(parts, key, normalizeFilter({ [rk]: val[rk] }));
			for (const ok of opKeys) parts.push({ [key]: { [ok]: val[ok] } });
		} else if (relKeys.length === 1) {
			const relKey = relKeys[0];
			liftAndPush(parts, key, normalizeFilter({ [relKey]: val[relKey] }));
		} else if (opKeys.length > 0) for (const ok of opKeys) parts.push({ [key]: { [ok]: val[ok] } });
	}
	if (parts.length === 0) return {};
	if (parts.length === 1) return parts[0];
	return { _and: parts };
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
function liftAndPush(parts, key, normalized) {
	const normKeys = Object.keys(normalized);
	if (normKeys.length === 1 && normKeys[0] === "_and") for (const sub of normalized._and) parts.push({ [key]: sub });
	else if (normKeys.length === 1 && normKeys[0] === "_or") parts.push({ _or: normalized._or.map((sub) => ({ [key]: sub })) });
	else parts.push({ [key]: normalized });
}

//#endregion
export { normalizeFilter };