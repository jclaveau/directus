import { scopedCachePurgeEnabled } from "./config.js";
import { resolveScopedCacheM2oJoinChainFromPath, scopedCacheFilterKeyingByCollection } from "./paths.js";
import { pinnedScopedCacheTagsFromKeyedFilters, pinnedScopedCacheTagsFromM2oParents, pinnedScopedCacheTagsFromO2mChildren, scopedCacheCollectionsBeyondNestedRows, scopedCacheFieldNamesByAliasedPath, scopedCacheNodeBoundsByCollection, scopedCacheRowsAtPathEnd, scopedCacheUnaliasedPath } from "./read-tags.js";
import { fieldMapFromAst } from "../permissions/modules/process-ast/lib/field-map-from-ast.js";
import { collectionsInFieldMap } from "../permissions/modules/process-ast/utils/collections-in-field-map.js";
import { useEnv } from "@directus/env";
import { toArray } from "@directus/utils";

//#region src/scoped-cache/read-plan.ts
const NO_FIELD_MAP = {
	read: /* @__PURE__ */ new Map(),
	other: /* @__PURE__ */ new Map()
};
/**
* What one read's tags are assembled from, in the two halves the query splits it
* into: what the AST alone decides, and what only the returned rows can say.
*
* The split is why this is an object rather than one call. The pins that read rows
* have to be filled from INSIDE `run-ast` — it is the only place the temporary
* primary keys still exist — while everything else must be derived before it,
* because `run-ast` returns early on an empty result and never reaches that
* callback. Deriving the field map there too would drop every collection's tag on
* exactly the reads that returned nothing.
*/
var ScopedCacheReadPlan = class {
	fieldMap;
	filterKeying;
	keyedFilterPins;
	beyondNestedRows;
	fieldNames;
	sortDeferred = /* @__PURE__ */ new Map();
	injectedAncestorPaths;
	nodeBounds;
	m2oParentPins = /* @__PURE__ */ new Map();
	o2mChildPins = /* @__PURE__ */ new Map();
	o2mConflicted = /* @__PURE__ */ new Set();
	constructor(collection, schema, ast, injections) {
		this.collection = collection;
		this.schema = schema;
		const enabled = scopedCachePurgeEnabled();
		this.fieldMap = enabled ? fieldMapFromAst(ast, schema) : NO_FIELD_MAP;
		this.fieldNames = enabled ? scopedCacheFieldNamesByAliasedPath(ast) : /* @__PURE__ */ new Map();
		this.filterKeying = enabled ? scopedCacheFilterKeyingByCollection(schema, ast) : /* @__PURE__ */ new Map();
		this.keyedFilterPins = pinnedScopedCacheTagsFromKeyedFilters(schema, collection, this.filterKeying);
		this.nodeBounds = enabled ? scopedCacheNodeBoundsByCollection(ast) : /* @__PURE__ */ new Map();
		this.injectedAncestorPaths = new Set(injections.map(({ aliasedPath }) => {
			return aliasedPath.split(".").slice(0, -1).join(".");
		}));
		const injectedAncestors = /* @__PURE__ */ new Set();
		for (const { path } of injections) {
			const joins = resolveScopedCacheM2oJoinChainFromPath(schema, collection, path.split(".").slice(0, -1));
			const ancestor = joins?.[joins.length - 1]?.relatedCollection;
			if (ancestor) injectedAncestors.add(ancestor);
		}
		this.beyondNestedRows = enabled ? scopedCacheCollectionsBeyondNestedRows(schema, ast, this.filterKeying, injectedAncestors, this.sortDeferred) : /* @__PURE__ */ new Set();
	}
	/**
	* Fill the pins that depend on what came back, from inside the read.
	*
	* `run-ast` injects every level's primary key for the nesting to work and strips
	* it again before the response, so this is the one moment a parent row can be
	* pinned BY that key. Not called for an empty result, which needs no pin: with
	* no row nested, the bare tag is already what each collection deserves.
	*/
	pinFromRows(rows) {
		if (!scopedCachePurgeEnabled()) return;
		this.markSortsCutByALimit(toArray(rows));
		this.m2oParentPins = pinnedScopedCacheTagsFromM2oParents(this.schema, this.collection, this.fieldMap, toArray(rows), this.fieldNames);
		this.o2mChildPins = pinnedScopedCacheTagsFromO2mChildren(this.schema, this.collection, this.fieldMap, toArray(rows), this.o2mConflicted, this.fieldNames);
	}
	/**
	* A to-many node sorted through to-one hops holds its rows whole when every
	* parent nested fewer than the node's limit — `mergeWithParentItems` cuts each
	* parent's set at that limit — and then the sort reorders only rows the key
	* pins name. A parent at the limit may hide a row ahead of the cut, whose write
	* is named by nothing: the sorted-through collection goes beyond the rows.
	*/
	markSortsCutByALimit(rows) {
		const env = useEnv();
		for (const [collection, deferrals] of this.sortDeferred) if (!deferrals.every(({ nodePath, limit, paged }) => {
			const effectiveLimit = limit ?? Number(env["QUERY_LIMIT_DEFAULT"]);
			if (paged) return false;
			if (effectiveLimit === -1) return true;
			const alias = nodePath[nodePath.length - 1];
			const prefix = nodePath.slice(0, -1);
			const parents = prefix.length === 0 ? rows : scopedCacheRowsAtPathEnd(rows, prefix);
			return parents !== null && parents.every((parent) => {
				const nested = parent[alias];
				return !Array.isArray(nested) || nested.length < effectiveLimit;
			});
		})) this.beyondNestedRows.add(collection);
	}
	/** A field-map path by the fields behind its aliases, for a schema lookup. */
	unaliased(path) {
		return scopedCacheUnaliasedPath(this.fieldNames, path.split("."));
	}
	/**
	* The collections whose purge counters this read has to capture: the ones its
	* tags will name. Both are known before the query — the field map is built off
	* the AST and the keying off the filter — which is what lets the capture predate
	* any purge racing the read.
	*/
	collectionsToGuard() {
		return [
			this.collection,
			...collectionsInFieldMap(this.fieldMap),
			...this.filterKeying.keys()
		];
	}
};

//#endregion
export { ScopedCacheReadPlan };