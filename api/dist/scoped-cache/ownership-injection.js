import { cloneDeep } from "../utils/lodash-es-used.js";
import { requestedFieldNestsPast, scopedCacheOwnershipNestedPkPaths } from "./paths.js";

//#region src/scoped-cache/ownership-injection.ts
/** Marks the hop an injection nests, so a response key is told from a field. */
const SCOPED_CACHE_INJECTED_PREFIX = "__scoped_cache_";
function scopedCacheOwnershipInjections(schema, collection, fields) {
	const nestedByCaller = (prefix) => {
		return fields.some((field) => requestedFieldNestsPast(field, prefix));
	};
	return scopedCacheOwnershipNestedPkPaths(schema, collection).flatMap((path) => {
		const segments = path.split(".");
		if (nestedByCaller(segments.slice(0, -1))) return [];
		let hop = 0;
		while (nestedByCaller(segments.slice(0, hop + 1))) hop++;
		const aliased = [...segments];
		aliased[hop] = `${SCOPED_CACHE_INJECTED_PREFIX}${segments[hop]}`;
		return [{
			path,
			aliasedPath: aliased.join(".")
		}];
	});
}
/** The query with the injections' paths requested and their aliases declared. */
function withScopedCacheOwnershipInjections(query, injections) {
	if (injections.length === 0) return query;
	const alias = { ...query.alias };
	const deep = cloneDeep(query.deep ?? {});
	for (const { path, aliasedPath } of injections) {
		const fields = path.split(".");
		const hop = injectedHop(aliasedPath);
		let aliases = alias;
		if (hop > 0) {
			let level = deep;
			for (const field of fields.slice(0, hop)) {
				level[field] ??= {};
				level = level[field];
			}
			level["_alias"] ??= {};
			aliases = level["_alias"];
		}
		aliases[`${SCOPED_CACHE_INJECTED_PREFIX}${fields[hop]}`] = fields[hop];
	}
	return {
		...query,
		fields: [...query.fields ?? ["*"], ...injections.map((injection) => injection.aliasedPath)],
		alias,
		deep
	};
}
/** Takes the injected hops back out of the rows, whatever they came back as. */
function stripScopedCacheOwnershipInjections(records, injections) {
	for (const { aliasedPath } of injections) {
		const segments = aliasedPath.split(".");
		const hop = injectedHop(aliasedPath);
		for (const record of records) {
			let node = record;
			for (const field of segments.slice(0, hop)) node = node !== null && typeof node === "object" ? node[field] : void 0;
			if (node !== null && typeof node === "object") delete node[segments[hop]];
		}
	}
}
function injectedHop(aliasedPath) {
	return aliasedPath.split(".").findIndex((segment) => segment.startsWith(SCOPED_CACHE_INJECTED_PREFIX));
}

//#endregion
export { SCOPED_CACHE_INJECTED_PREFIX, scopedCacheOwnershipInjections, stripScopedCacheOwnershipInjections, withScopedCacheOwnershipInjections };