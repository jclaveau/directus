import { canonicalScopedCacheValue, isPinnableScopeType, scopedCacheMaxPinsPerCollection, scopedCacheTagsFromRows } from "./tags.js";
import { joinFilterWithCases } from "../database/run-ast/lib/apply-query/join-filter-with-cases.js";
import { getRelationInfo } from "../utils/get-relation-info.js";
import { composeScopedCachePaths, m2oParentRowsAtPathEnd, resolveScopedCacheM2oJoinChainFromPath, scopedCacheFilterKeyingByCollection } from "./paths.js";
import { extractFieldsFromQuery } from "../permissions/modules/process-ast/lib/extract-fields-from-query.js";

//#region src/scoped-cache/read-tags.ts
/**
* Scope a read's joined collections off the keys its filters named — the third
* pinner beside `pinnedScopedCacheTagsFromFilter`, which bounds the root off the
* same filter, and `pinnedScopedCacheTagsFromM2oParents`, which pins the nested
* ones off the rows they carried.
*
* A collection reached ONLY through a filter is nested nowhere, so neither of
* those two can say anything about it and it has always fallen through to the
* bare tag — one write anywhere in it dropping every read that merely joined it.
* When the filter named its rows by key, the read depends on those rows and no
* others, so `<collection>:<pk>=<key>` is exactly right and the write side
* already emits it: `snapshotScopedCacheTags` writes the key slice of every
* mutated row of every collection, declared scope fields or not.
*
* The root is left out: its own filter bounds it through
* `pinnedScopedCacheTagsFromFilter`, under a self-reference guard this analysis
* does not reproduce.
*
* Past the per-collection ceiling the pin is dropped rather than trimmed — a
* partial key set would leave the rows it omits covered by nothing.
*/
function pinnedScopedCacheTagsFromKeyedFilters(schema, rootCollection, keyingByCollection) {
	const pinned = /* @__PURE__ */ new Map();
	for (const [collection, keying] of keyingByCollection) {
		if (collection === rootCollection || keying.kind !== "keyed") continue;
		const type = schema.collections[collection]?.fields[keying.field]?.type;
		if (type === void 0 || !isPinnableScopeType(type)) continue;
		if (keying.keys.size > scopedCacheMaxPinsPerCollection()) continue;
		const tags = [];
		const seen = /* @__PURE__ */ new Set();
		for (const value of keying.keys) {
			const token = canonicalScopedCacheValue(value, type);
			if (seen.has(token)) continue;
			seen.add(token);
			tags.push({
				collection,
				field: keying.field,
				value,
				type
			});
		}
		pinned.set(collection, tags);
	}
	return pinned;
}
/**
* The collections the read NESTS — every one that has a node of its own in the
* AST, whichever direction its relation runs.
*
* A nested collection is depended on for the rows it CARRIED, not only for the
* ones a filter named: `mergeWithParentItems` writes what the nested query
* returned, so an insert that joins it changes the response. Only
* `pinnedScopedCacheTagsFromM2oParents` can name that half, and it declines a
* to-many or A2O hop. Naming them here lets the caller keep such a collection
* bare even when its filter named keys — those keys cover the filter's half of
* the dependency and say nothing about the nested one.
*/
function scopedCacheNestedCollections(ast) {
	const nested = /* @__PURE__ */ new Set();
	const addNestedBy = (children) => {
		for (const child of children) {
			if (child.type === "field" || child.type === "functionField") continue;
			if (child.type === "a2o") {
				for (const name of child.names) {
					nested.add(name);
					addNestedBy(child.children[name] ?? []);
				}
				continue;
			}
			nested.add(child.name);
			addNestedBy(child.children);
		}
	};
	addNestedBy(ast.children);
	return nested;
}
/**
* The collections a read depends on BEYOND the parent rows it nested, so keying the
* pin on those rows would leave the entry alive through a write that changes
* what the read returns.
*
* - A query sorts, groups or aggregates on a path into it, so rows the response
*   never nested decide which rows come back, named by nothing.
* - A query FILTERS on a path into it that names no key (`keyingByCollection`),
*   same reason. A filter that does name keys is the one case that survives:
*   the rows it reaches are exactly those keys, which
*   `pinnedScopedCacheTagsFromKeyedFilters` pins alongside whatever the response
*   nested. Read off EVERY node's query, not only the root's: a nested node's
*   filter withholds parents, and which ones it withholds is decided by every
*   collection that filter reads — each of them one the response may have nested
*   only in part.
* - A nested node carries a field-level case, so a parent it references can be
*   withheld and arrive as a null slot — which `mergeWithParentItems` writes for
*   a null foreign key too, leaving the two indistinguishable once merged.
*/
function scopedCacheCollectionsBeyondNestedRows(schema, ast, keyingByCollection = scopedCacheFilterKeyingByCollection(schema, ast)) {
	const beyond = /* @__PURE__ */ new Set();
	const addCollectionsQueriedBy = (collection, query, cases) => {
		const queryFieldMap = {
			read: /* @__PURE__ */ new Map(),
			other: /* @__PURE__ */ new Map()
		};
		extractFieldsFromQuery(collection, {
			...query,
			filter: joinFilterWithCases(query.filter, cases)
		}, queryFieldMap, schema);
		const sortedFieldMap = {
			read: /* @__PURE__ */ new Map(),
			other: /* @__PURE__ */ new Map()
		};
		const groupedFieldMap = {
			read: /* @__PURE__ */ new Map(),
			other: /* @__PURE__ */ new Map()
		};
		const sortedQuery = {};
		if (query.sort) sortedQuery.sort = query.sort;
		extractFieldsFromQuery(collection, sortedQuery, sortedFieldMap, schema);
		const groupedQuery = {};
		if (query.group) groupedQuery.group = query.group;
		if (query.aggregate) groupedQuery.aggregate = query.aggregate;
		extractFieldsFromQuery(collection, groupedQuery, groupedFieldMap, schema);
		const sorted = /* @__PURE__ */ new Set();
		for (const [, entry] of [...sortedFieldMap.read, ...sortedFieldMap.other]) sorted.add(entry.collection);
		const groupedOrAggregated = /* @__PURE__ */ new Set();
		for (const [, entry] of [...groupedFieldMap.read, ...groupedFieldMap.other]) groupedOrAggregated.add(entry.collection);
		for (const [, entry] of [...queryFieldMap.read, ...queryFieldMap.other]) {
			const collection$1 = entry.collection;
			const kind = keyingByCollection.get(collection$1)?.kind;
			const namedByFilter = kind === "keyed" || kind === "independent";
			const hasCoveringSlice = (schema.collections[collection$1]?.scopedCacheFields ?? []).length > 0 && kind !== "independent";
			const crossesMembership = groupedOrAggregated.has(collection$1) || sorted.has(collection$1) && !hasCoveringSlice;
			if (namedByFilter && !crossesMembership) continue;
			beyond.add(collection$1);
		}
	};
	addCollectionsQueriedBy(ast.name, ast.query, ast.cases);
	const addWhatNestedM2oNodesDependOn = (children) => {
		for (const child of children) {
			if (child.type !== "m2o") continue;
			addCollectionsQueriedBy(child.relation.related_collection, child.query, child.cases);
			if (child.whenCase.length > 0) beyond.add(child.relation.related_collection);
			addWhatNestedM2oNodesDependOn(child.children);
		}
	};
	addWhatNestedM2oNodesDependOn(ast.children);
	return beyond;
}
/**
* Scope a read's NON-root collections off the parent rows it nested — the other
* half of `pinnedScopedCacheTagsFromFilter`, which bounds the root.
*
* Per touched collection, the first of these that holds:
*
* - `<pk>=<key>` per parent row — M2O hops only. An INSERT lands a key this
*   response cannot have nested, so the pin cannot go stale.
* - its own declared scope slices — past the ceiling. One tag per distinct value.
* - the bare collection tag — a to-many hop or A2O anywhere on one of its paths, no
*   parent row nested, a row missing its key, or the read depending on it
*   beyond what it nested (`scopedCacheCollectionsBeyondNestedRows`).
*
* Returns the pinned collections only; the bare tag is the caller's default, so a
* collection absent here keeps the tag it has always carried. Each fallback
* over-purges, none serves stale.
*/
function pinnedScopedCacheTagsFromM2oParents(schema, rootCollection, fieldMap, records, collectionsBeyondNestedRows) {
	const pathsByCollection = /* @__PURE__ */ new Map();
	for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) {
		if (entry.collection === rootCollection) continue;
		if (collectionsBeyondNestedRows.has(entry.collection)) continue;
		const paths = pathsByCollection.get(entry.collection) ?? /* @__PURE__ */ new Set();
		paths.add(path);
		pathsByCollection.set(entry.collection, paths);
	}
	const pinned = /* @__PURE__ */ new Map();
	for (const [collection, paths] of pathsByCollection) {
		const primaryKeyField = schema.collections[collection]?.primary;
		const collectionFields = schema.collections[collection]?.fields ?? {};
		if (primaryKeyField === void 0) continue;
		const rows = [];
		let pinnableFromNestedRows = true;
		for (const path of paths) {
			const segments = path.split(".");
			const lastField = segments[segments.length - 1];
			let parentRows;
			if (resolveScopedCacheM2oJoinChainFromPath(schema, rootCollection, segments) !== null) parentRows = m2oParentRowsAtPathEnd(records, segments);
			else {
				const parentCollection = scopedCacheCollectionAtPathEnd(schema, rootCollection, segments.slice(0, -1));
				if (parentCollection === null || lastField === void 0 || getRelationInfo(schema.relations, parentCollection, lastField).relationType !== "m2o") {
					pinnableFromNestedRows = false;
					break;
				}
				parentRows = scopedCacheRowsAtPathEnd(records, segments);
			}
			if (parentRows === null) {
				pinnableFromNestedRows = false;
				break;
			}
			for (const parentRow of parentRows) rows.push(parentRow);
		}
		if (pinnableFromNestedRows === false) continue;
		if (rows.length === 0) continue;
		const keyTags = scopedCacheTagsFromRows(collection, [primaryKeyField], rows, "coarse", { [primaryKeyField]: collectionFields[primaryKeyField]?.type });
		if (keyTags !== null && keyTags.length <= scopedCacheMaxPinsPerCollection()) {
			pinned.set(collection, keyTags);
			continue;
		}
		const sliceFields = (schema.collections[collection]?.scopedCacheFields ?? []).filter((field) => !field.includes("."));
		if (sliceFields.length === 0) continue;
		const sliceFieldTypes = {};
		for (const field of sliceFields) sliceFieldTypes[field] = collectionFields[field]?.type;
		const sliceTags = scopedCacheTagsFromRows(collection, sliceFields, rows, "coarse", sliceFieldTypes);
		if (sliceTags !== null && sliceTags.length <= scopedCacheMaxPinsPerCollection()) pinned.set(collection, sliceTags);
	}
	return pinned;
}
/**
* The collection a relational path ends at, walking an M2O into its one related row
* and an O2M into its children alike. Null on an A2O or unknown field, whose target
* is not a single collection.
*/
function scopedCacheCollectionAtPathEnd(schema, collection, segments) {
	let current = collection;
	for (const field of segments) {
		const { relation, relationType } = getRelationInfo(schema.relations, current, field);
		let related = null;
		if (relationType === "m2o") related = relation?.related_collection;
		else if (relationType === "o2m") related = relation?.collection;
		if (!related) return null;
		current = related;
	}
	return current;
}
/**
* Every row a relational path reaches, in document order, descending an M2O into its
* one related row and an O2M into each of its children — so a deep O2M prefix still
* yields the parent rows the pin keys on. Null when the response cannot answer the
* path: a segment it never carried, or a scalar where a relation was expected.
*/
function scopedCacheRowsAtPathEnd(records, segments) {
	let current = records;
	for (const segment of segments) {
		const next = [];
		for (const row of current) {
			const value = row[segment];
			if (value === null || value === void 0) continue;
			if (Array.isArray(value)) {
				for (const element of value) if (element !== null && typeof element === "object") next.push(element);
			} else if (typeof value === "object") next.push(value);
			else return null;
		}
		current = next;
	}
	return current;
}
/**
* The to-many twin of `pinnedScopedCacheTagsFromM2oParents`. A read that EMBEDS a
* to-many child set depends on every child WHERE `child.<fk> = parent.pk`, so it
* pins each such collection by that reverse fk = the parent's key — one tag per
* surfaced parent row. A write to a child of another parent no longer evicts it.
*
* The purge side already emits the identical `<child>:<fk>=<value>` shallow tag
* from the mutated row's own fk column (the flat scope-field branch of
* `snapshotScopedCacheTags`), so read and write agree by construction — no field
* injection, no response strip, no deep chain. The read never needs the child's fk
* value: it equals the parent pk by definition of the O2M join.
*
* Pins where the parent rows are in reach AND the write will match: the last hop is
* O2M whose reverse fk is a flat scope field (else the purge emits no match), and
* the prefix descends to parent rows carrying their key — through a to-many too,
* so a deep pivot under an all-O2M chain slices. Past the per-collection pin ceiling
* it falls back to the bare tag; an A2O anywhere on the path keeps it bare.
*/
function pinnedScopedCacheTagsFromO2mChildren(schema, rootCollection, fieldMap, records, collectionsBeyondNestedRows, conflictedOut) {
	const keyingByChild = /* @__PURE__ */ new Map();
	for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) {
		const childCollection = entry.collection;
		if (childCollection === rootCollection) continue;
		if (collectionsBeyondNestedRows.has(childCollection)) continue;
		const segments = path.split(".");
		const aliasField = segments[segments.length - 1];
		if (aliasField === void 0) continue;
		const prefix = segments.slice(0, -1);
		let parentCollection = rootCollection;
		if (prefix.length > 0) {
			const resolved = scopedCacheCollectionAtPathEnd(schema, rootCollection, prefix);
			if (resolved === null) continue;
			parentCollection = resolved;
		}
		const { relation, relationType } = getRelationInfo(schema.relations, parentCollection, aliasField);
		if (relationType !== "o2m" || !relation || relation.collection !== childCollection) continue;
		const reverseFk = relation.field;
		const parentPkField = schema.collections[parentCollection]?.primary;
		if (parentPkField === void 0) continue;
		if (!(schema.collections[childCollection]?.scopedCacheFields ?? []).filter((field) => !field.includes(".")).includes(reverseFk)) continue;
		const parentRows = prefix.length === 0 ? records : scopedCacheRowsAtPathEnd(records, prefix);
		if (parentRows === null) continue;
		const fieldType = schema.collections[childCollection]?.fields[reverseFk]?.type;
		const keying = keyingByChild.get(childCollection) ?? {
			reverseFk,
			fieldType,
			rows: [],
			conflicted: false
		};
		if (keying.reverseFk !== reverseFk) {
			keying.conflicted = true;
			keyingByChild.set(childCollection, keying);
			continue;
		}
		for (const parentRow of parentRows) keying.rows.push(parentPkField in parentRow ? { [reverseFk]: parentRow[parentPkField] } : {});
		keyingByChild.set(childCollection, keying);
	}
	const pinned = /* @__PURE__ */ new Map();
	for (const [collection, keying] of keyingByChild) {
		if (keying.conflicted && conflictedOut) conflictedOut.add(collection);
		if (keying.conflicted || keying.rows.length === 0) continue;
		const keyTags = scopedCacheTagsFromRows(collection, [keying.reverseFk], keying.rows, "coarse", { [keying.reverseFk]: keying.fieldType });
		if (keyTags !== null && keyTags.length <= scopedCacheMaxPinsPerCollection()) pinned.set(collection, keyTags);
	}
	return pinned;
}
/**
* Scope a read's root cache tags off a filter — the read side. A read is soundly
* scoped to a value slice only when the filter *bounds* it to that value: a future
* insert with a new scope value must be excluded by the same filter, or the read
* would silently miss it. Tags come from `_eq`/`_in` on a scoped field (flat or
* relational `{ fk: { <pk>: … } }`). Each node reports its tags plus whether it
* *covers* every row it matches (i.e. binds a pinnable field on that row), combined
* by operator: - `_and`/root union a field's values and are covered if ANY conjunct
* is (a row satisfies every conjunct); the value union over-approximates the
* intersection — over-purges, never stale. - `_or` is sound only when EVERY branch
* is covered (else a row matching an uncovered branch carries no pinned tag →
* stale); then its tags are the union across branches — a matching row satisfies one
* branch, whose covering tag lies in that union. This holds across *different*
* fields too: `{ _or: [{ owner }, { dept }] }` pins both, purged if a write touches
* either. This is what scopes a permission-isolated read: the caller passes
* `joinFilterWithCases(query.filter, ast.cases)`, whose `{ _or: cases }` is unioned
* by that rule (one case = its own values; a case that leaves ALL fields unbound →
* bare). No pinned field → `[]`, and the caller falls back to the bare collection
* tag. `fieldTypes` canonicalizes a value the way the purge side does and skips
* date-ish types (not pin-safe, `PIN_UNSAFE_SCOPE_TYPES`).
*
* `primaryKeyField` joins the declared fields implicitly and always, no config: -
* Every row has a primary key, so this axis always resolves. - An inserted row
* carries a different key, so it can never join a `<pk>._eq` or `<pk>._in` read's
* result set — the insert-blindness that bars a value slice elsewhere cannot bite
* here. - The purge side emits the same tag from the keys it already holds, so read
* and write agree without either paying a query for it.
*/
function pinnedScopedCacheTagsFromFilter(collection, fields, filter, fieldTypes = {}, relatedPrimaryKeys = {}, scopedCachePaths = [], primaryKeyField) {
	const fieldSet = new Set(fields);
	if (primaryKeyField !== void 0) fieldSet.add(primaryKeyField);
	if (!filter || fieldSet.size === 0 && scopedCachePaths.length === 0) return [];
	const pathsByHead = /* @__PURE__ */ new Map();
	for (const path of scopedCachePaths) {
		const head = path.segments[0];
		if (head === void 0) continue;
		const group = pathsByHead.get(head) ?? [];
		group.push(path);
		pathsByHead.set(head, group);
	}
	function unionTags(target, source) {
		for (const [field, values] of source) {
			const seen = target.get(field) ?? /* @__PURE__ */ new Set();
			for (const value of values) seen.add(value);
			target.set(field, seen);
		}
	}
	function evalLeaf(field, value) {
		const tags$1 = /* @__PURE__ */ new Map();
		if (!fieldSet.has(field) || !isPinnableScopeType(fieldTypes[field]) || value === null || typeof value !== "object") return {
			tags: tags$1,
			covered: false
		};
		const ops = value;
		if ("_eq" in ops) tags$1.set(field, new Set([ops["_eq"]]));
		else if ("_in" in ops && Array.isArray(ops["_in"])) tags$1.set(field, new Set(ops["_in"]));
		else {
			const relatedPrimaryKey = relatedPrimaryKeys[field];
			const inner = relatedPrimaryKey === void 0 ? void 0 : ops[relatedPrimaryKey];
			if (inner !== null && typeof inner === "object") {
				const innerOps = inner;
				if ("_eq" in innerOps) tags$1.set(field, new Set([innerOps["_eq"]]));
				else if ("_in" in innerOps && Array.isArray(innerOps["_in"])) tags$1.set(field, new Set(innerOps["_in"]));
			}
		}
		return {
			tags: tags$1,
			covered: tags$1.size > 0
		};
	}
	function pathTerminalValues(segments, value, terminalRelatedPk) {
		let node = value;
		for (let i = 1; i < segments.length; i++) {
			if (node === null || typeof node !== "object") return null;
			node = node[segments[i]];
		}
		if (node === null || typeof node !== "object") return null;
		const ops = node;
		if ("_eq" in ops) return new Set([ops["_eq"]]);
		if ("_in" in ops && Array.isArray(ops["_in"])) return new Set(ops["_in"]);
		const inner = terminalRelatedPk === void 0 ? void 0 : ops[terminalRelatedPk];
		if (inner !== null && typeof inner === "object") {
			const innerOps = inner;
			if ("_eq" in innerOps) return new Set([innerOps["_eq"]]);
			if ("_in" in innerOps && Array.isArray(innerOps["_in"])) return new Set(innerOps["_in"]);
		}
		return null;
	}
	function evalPathsAt(headField, value) {
		const tags$1 = /* @__PURE__ */ new Map();
		const paths = pathsByHead.get(headField);
		if (!paths || value === null || typeof value !== "object") return {
			tags: tags$1,
			covered: false
		};
		for (const { field, segments } of paths) {
			if (!isPinnableScopeType(fieldTypes[field])) continue;
			const values = pathTerminalValues(segments, value, relatedPrimaryKeys[field]);
			if (values !== null && values.size > 0) tags$1.set(field, values);
		}
		return {
			tags: tags$1,
			covered: tags$1.size > 0
		};
	}
	function evalOr(branches) {
		if (branches.length === 0 || !branches.every((branch) => branch.covered)) return {
			tags: /* @__PURE__ */ new Map(),
			covered: false
		};
		const tags$1 = /* @__PURE__ */ new Map();
		for (const branch of branches) unionTags(tags$1, branch.tags);
		return {
			tags: tags$1,
			covered: true
		};
	}
	function evalNode(node) {
		const result = {
			tags: /* @__PURE__ */ new Map(),
			covered: false
		};
		function andIn(part) {
			unionTags(result.tags, part.tags);
			result.covered = result.covered || part.covered;
		}
		for (const [key, value] of Object.entries(node)) if (key === "_and" && Array.isArray(value)) for (const sub of value) andIn(evalNode(sub));
		else if (key === "_or" && Array.isArray(value)) andIn(evalOr(value.map((sub) => evalNode(sub))));
		else {
			andIn(evalLeaf(key, value));
			andIn(evalPathsAt(key, value));
		}
		return result;
	}
	const pinned = evalNode(filter);
	const tags = [];
	for (const [field, values] of pinned.tags) for (const value of values) tags.push({
		collection,
		field,
		value,
		type: fieldTypes[field]
	});
	return tags;
}
/**
* The paths a read can pin a would-be-bare nested collection BY, instead of the bare
* tag, when an ancestor its ownership chain crosses is itself pinned in the read —
* nearest first. Every row the collection surfaced belongs to that ancestor's slice,
* so a per-slice pin stands in for the whole-collection tag.
*
* Every hop is a scoped-cache ownership edge (`scopedCacheFields`), so a write to
* the near collection purges every key a candidate names — the invariant keeping the
* slice sound. `field` is the dotted key the matching pin's value slices on — the
* same key `composeScopedCachePaths` hands the purge, so read pin and purge agree;
* `ancestor` is the collection that key reaches; `terminalField` is the field on it
* a pin must name for the candidate to apply.
*
* Two shapes, both ownership-covered:
* - a flat parent fk (`discipline`) reaching the 1-hop ancestor by its own key, and
* - a composed relational path (`discipline.enrollment.student.user`) reaching a
*   deeper ancestor's scope field.
*/
function scopedCacheAncestorSliceCandidates(schema, collection) {
	const candidates = [];
	for (const field of schema.collections[collection]?.scopedCacheFields ?? []) {
		if (field.includes(".")) continue;
		const target = schema.relations.find((rel) => {
			return rel.collection === collection && rel.field === field;
		})?.related_collection;
		const targetPk = target ? schema.collections[target]?.primary : void 0;
		if (!target || !targetPk) continue;
		candidates.push({
			field,
			ancestor: target,
			terminalField: targetPk
		});
	}
	for (const path of composeScopedCachePaths(schema, collection)) {
		const terminalField = path.segments[path.segments.length - 1];
		const joins = resolveScopedCacheM2oJoinChainFromPath(schema, collection, path.segments.slice(0, -1));
		const ancestor = joins?.[joins.length - 1]?.relatedCollection;
		if (!ancestor || terminalField === void 0) continue;
		candidates.push({
			field: path.field,
			ancestor,
			terminalField
		});
	}
	return candidates.sort((a, b) => {
		return a.field.split(".").length - b.field.split(".").length;
	});
}

//#endregion
export { pinnedScopedCacheTagsFromFilter, pinnedScopedCacheTagsFromKeyedFilters, pinnedScopedCacheTagsFromM2oParents, pinnedScopedCacheTagsFromO2mChildren, scopedCacheAncestorSliceCandidates, scopedCacheCollectionsBeyondNestedRows, scopedCacheNestedCollections };