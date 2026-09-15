import { scopedCachePurgeEnabled } from "./config.js";
import { resolveScopedCacheM2oJoinChainFromPath, scopedCacheFilterKeyingByCollection } from "./paths.js";
import { pinnedScopedCacheTagsFromKeyedFilters, pinnedScopedCacheTagsFromM2oParents, pinnedScopedCacheTagsFromO2mChildren, scopedCacheCollectionsBeyondNestedRows } from "./read-tags.js";
import { fieldMapFromAst } from "../permissions/modules/process-ast/lib/field-map-from-ast.js";
import { collectionsInFieldMap } from "../permissions/modules/process-ast/utils/collections-in-field-map.js";
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
	m2oParentPins = /* @__PURE__ */ new Map();
	o2mChildPins = /* @__PURE__ */ new Map();
	o2mConflicted = /* @__PURE__ */ new Set();
	constructor(collection, schema, ast, injectedOwnershipPaths) {
		this.collection = collection;
		this.schema = schema;
		const enabled = scopedCachePurgeEnabled();
		this.fieldMap = enabled ? fieldMapFromAst(ast, schema) : NO_FIELD_MAP;
		this.filterKeying = enabled ? scopedCacheFilterKeyingByCollection(schema, ast) : /* @__PURE__ */ new Map();
		this.keyedFilterPins = pinnedScopedCacheTagsFromKeyedFilters(schema, collection, this.filterKeying);
		this.beyondNestedRows = enabled ? scopedCacheCollectionsBeyondNestedRows(schema, ast, this.filterKeying) : /* @__PURE__ */ new Set();
		for (const path of injectedOwnershipPaths) {
			const joins = resolveScopedCacheM2oJoinChainFromPath(schema, collection, path.split(".").slice(0, -1));
			const ancestor = joins?.[joins.length - 1]?.relatedCollection;
			if (ancestor) this.beyondNestedRows.delete(ancestor);
		}
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
		this.m2oParentPins = pinnedScopedCacheTagsFromM2oParents(this.schema, this.collection, this.fieldMap, toArray(rows), this.beyondNestedRows);
		this.o2mChildPins = pinnedScopedCacheTagsFromO2mChildren(this.schema, this.collection, this.fieldMap, toArray(rows), this.beyondNestedRows, this.o2mConflicted);
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