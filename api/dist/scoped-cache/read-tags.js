import { canonicalScopedCacheValue, isPinnableScopeType, scopedCacheMaxPinsPerCollection, scopedCacheTagsFromRows } from "./tags.js";
import { joinFilterWithCases } from "../database/run-ast/lib/apply-query/join-filter-with-cases.js";
import { getRelationInfo } from "../utils/get-relation-info.js";
import { m2oParentRowsAtPathEnd, resolveScopedCacheM2oJoinChainFromPath, scopedCacheFilterKeyingByCollection, scopedCacheKeyedFieldType } from "./paths.js";
import { extractFieldsFromQuery } from "../permissions/modules/process-ast/lib/extract-fields-from-query.js";

//#region src/scoped-cache/read-tags.ts
/**
* Whether a keyed filter's keys become pins: a field to canonicalize against
* that is not date-ish — the write canonicalizes those differently — and a key
* set within the per-collection ceiling. Past it the pin is dropped rather than
* trimmed, since a partial key set would leave the rows it omits covered by
* nothing; either way the collection is then named by no pin, and depended on
* beyond whatever rows the read nested.
*/
function keyedFilterPinnable(schema, collection, keying) {
	if (keying.kind !== "keyed") return false;
	const type = scopedCacheKeyedFieldType(schema, collection, keying.field);
	return type !== void 0 && isPinnableScopeType(type) && keying.keys.size <= scopedCacheMaxPinsPerCollection();
}
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
*/
function pinnedScopedCacheTagsFromKeyedFilters(schema, rootCollection, keyingByCollection) {
	const pinned = /* @__PURE__ */ new Map();
	for (const [collection, keying] of keyingByCollection) {
		if (collection === rootCollection || !keyedFilterPinnable(schema, collection, keying)) continue;
		const type = scopedCacheKeyedFieldType(schema, collection, keying.field);
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
* What bounds the rows each node of a collection returns — its own filter joined
* with its cases, the WHERE its query runs under — one entry per node, `null` for
* a node nothing bounds. Unlike the root's filter, which bounds nothing it
* nested, a node's bound gates every row that node returns whichever way the
* read reached it: a to-many under another to-many, a junction whose reverse fk
* is no scope field, an M2O whose parent a case withholds. So a slice every
* node's bound binds names every row the read carries of that collection, and a
* write to any row entering or leaving that slice emits it.
*/
function scopedCacheNodeBoundsByCollection(ast) {
	const bounds = /* @__PURE__ */ new Map();
	const addBound = (collection, query, cases) => {
		const known = bounds.get(collection) ?? [];
		known.push(joinFilterWithCases(query.filter, cases));
		bounds.set(collection, known);
	};
	const addBoundsOf = (children) => {
		for (const child of children) {
			if (child.type === "field") continue;
			if (child.type === "functionField") {
				addBound(child.relatedCollection, child.query, child.cases);
				continue;
			}
			if (child.type === "a2o") {
				for (const name of child.names) {
					addBound(name, child.query[name] ?? {}, child.cases[name] ?? []);
					addBoundsOf(child.children[name] ?? []);
				}
				continue;
			}
			addBound(child.name, child.query, child.cases);
			addBoundsOf(child.children);
		}
	};
	addBoundsOf(ast.children);
	return bounds;
}
/**
* The field each nested node's path stands for, keyed by the path the field map
* and the rows carry — every hop under its alias (`alias[start]=days` files the
* node under `start`) — so a pin resolves the relation behind an alias where the
* schema knows only the field.
*/
function scopedCacheFieldNamesByAliasedPath(ast) {
	const names = /* @__PURE__ */ new Map();
	const addNamesUnder = (children, prefix) => {
		for (const child of children) {
			if (child.type === "field" || child.type === "functionField") continue;
			const path = [...prefix, child.fieldKey];
			if (child.type === "a2o") {
				names.set(path.join("."), child.relation.field);
				for (const name of child.names) addNamesUnder(child.children[name] ?? [], path);
				continue;
			}
			names.set(path.join("."), child.type === "o2m" ? child.relation.meta?.one_field ?? child.fieldKey : child.relation.field);
			addNamesUnder(child.children, path);
		}
	};
	addNamesUnder(ast.children, []);
	return names;
}
/**
* A field-map path with each alias replaced by the field it stands for: what
* the schema's relations are looked up by, where the rows are still descended by
* the aliased one.
*/
function scopedCacheUnaliasedPath(fieldNames, segments) {
	return segments.map((segment, at) => {
		return fieldNames.get(segments.slice(0, at + 1).join(".")) ?? segment;
	});
}
/**
* The purge side emits `<child>:<fk>=<value>` only when the fk is a declared
* flat scope field; otherwise a child write emits just its pk slice, which an
* INSERT of a new child never carries — so a pin on the parent's key would serve
* stale. Pin only when the matching shallow tag is guaranteed on the write.
*/
function scopedCacheO2mChildPinnedByParentKey(schema, childCollection, reverseFk) {
	return (schema.collections[childCollection]?.scopedCacheFields ?? []).filter((field) => !field.includes(".")).includes(reverseFk);
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
*   filter withholds rows, and which ones it withholds is decided by every
*   collection that filter reads — each of them one the response may have nested
*   only in part. A to-many node is walked like any other; only what its own
*   columns decide is covered, and only when its parent's key pins it.
* - A nested node reads under only SOME of its parent's cases, so a parent it
*   references can be withheld and arrive as a null slot — which
*   `mergeWithParentItems` writes for a null foreign key too, leaving the two
*   indistinguishable once merged. Reading under every case withholds nothing:
*   a row is returned only when it matched one of them.
*/
function scopedCacheCollectionsBeyondNestedRows(schema, ast, keyingByCollection = scopedCacheFilterKeyingByCollection(schema, ast), exemptFromCaseGating = /* @__PURE__ */ new Set(), sortDeferredOut) {
	const beyond = /* @__PURE__ */ new Set();
	const addCollectionsQueriedBy = (collection, query, cases, ownColumnsCovered = false, nodePath = null) => {
		const ownColumn = ([path, entry]) => {
			return path === "" && entry.collection === collection;
		};
		const queryFieldMap = {
			read: /* @__PURE__ */ new Map(),
			other: /* @__PURE__ */ new Map()
		};
		extractFieldsFromQuery(collection, query, queryFieldMap, schema);
		const queriedEntries = [...queryFieldMap.read, ...queryFieldMap.other].filter((entry) => !(ownColumnsCovered && ownColumn(entry)));
		const caseFieldMap = {
			read: /* @__PURE__ */ new Map(),
			other: /* @__PURE__ */ new Map()
		};
		extractFieldsFromQuery(collection, { filter: joinFilterWithCases(null, cases) }, caseFieldMap, schema);
		const casedEntries = [...caseFieldMap.read, ...caseFieldMap.other].filter((entry) => {
			return !(ownColumnsCovered && ownColumn(entry)) && !(entry[1].collection === collection && exemptFromCaseGating.has(collection));
		});
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
		const filteredFieldMap = {
			read: /* @__PURE__ */ new Map(),
			other: /* @__PURE__ */ new Map()
		};
		const filteredQuery = {};
		if (query.filter) filteredQuery.filter = query.filter;
		if (query.search) filteredQuery.search = query.search;
		extractFieldsFromQuery(collection, filteredQuery, filteredFieldMap, schema);
		const filtered = /* @__PURE__ */ new Set();
		for (const [, entry] of [...filteredFieldMap.read, ...filteredFieldMap.other]) filtered.add(entry.collection);
		const groupedOrAggregated = /* @__PURE__ */ new Set();
		for (const [, entry] of [...groupedFieldMap.read, ...groupedFieldMap.other]) groupedOrAggregated.add(entry.collection);
		for (const entry of [...queriedEntries, ...casedEntries]) {
			const queried = entry[1].collection;
			const keying = keyingByCollection.get(queried);
			const kind = keying?.kind;
			const namedByFilter = kind === "independent" || keying !== void 0 && keyedFilterPinnable(schema, queried, keying);
			const hasCoveringSlice = (schema.collections[queried]?.scopedCacheFields ?? []).length > 0 && kind !== "independent";
			const crossesMembership = groupedOrAggregated.has(queried) || sorted.has(queried) && !hasCoveringSlice;
			if (namedByFilter && !crossesMembership) continue;
			if (nodePath !== null && sortDeferredOut !== void 0 && sorted.has(queried) && !filtered.has(queried) && !groupedOrAggregated.has(queried) && !casedEntries.some(([, cased]) => cased.collection === queried) && resolveScopedCacheM2oJoinChainFromPath(schema, collection, entry[0].split(".")) !== null) {
				const deferrals = sortDeferredOut.get(queried) ?? [];
				deferrals.push({
					nodePath,
					limit: query.limit ?? null,
					paged: (query.page ?? 0) > 1 || (query.offset ?? 0) > 0
				});
				sortDeferredOut.set(queried, deferrals);
				continue;
			}
			beyond.add(queried);
		}
	};
	addCollectionsQueriedBy(ast.name, ast.query, ast.cases);
	const readsUnderEveryCase = (whenCase, cases) => {
		return cases.length > 0 && cases.every((_, index) => whenCase.includes(index));
	};
	const addWhatNestedNodesDependOn = (children, cases, prefix) => {
		for (const child of children) {
			if (child.type === "field") continue;
			if (child.type === "functionField") {
				addCollectionsQueriedBy(child.relatedCollection, child.query, child.cases);
				continue;
			}
			const path = [...prefix, child.fieldKey];
			if (child.type === "a2o") {
				for (const name of child.names) {
					const namedCases = child.cases[name] ?? [];
					addCollectionsQueriedBy(name, child.query[name] ?? {}, namedCases);
					addWhatNestedNodesDependOn(child.children[name] ?? [], namedCases, path);
				}
				continue;
			}
			if (child.type === "o2m") {
				addCollectionsQueriedBy(child.name, child.query, child.cases, scopedCacheO2mChildPinnedByParentKey(schema, child.name, child.relation.field), path);
				addWhatNestedNodesDependOn(child.children, child.cases, path);
				continue;
			}
			addCollectionsQueriedBy(child.relation.related_collection, child.query, child.cases);
			if (child.whenCase.length > 0 && !readsUnderEveryCase(child.whenCase, cases) && !exemptFromCaseGating.has(child.relation.related_collection)) beyond.add(child.relation.related_collection);
			addWhatNestedNodesDependOn(child.children, child.cases, path);
		}
	};
	addWhatNestedNodesDependOn(ast.children, ast.cases, []);
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
*   parent row nested, or a row missing its key.
*
* Returns the pinned collections only; the bare tag is the caller's default, so a
* collection absent here keeps the tag it has always carried. Each fallback
* over-purges, none serves stale. The pins name the NESTED rows and nothing more:
* a read depending on a collection beyond them
* (`scopedCacheCollectionsBeyondNestedRows`) owes that half to the caller.
*/
function pinnedScopedCacheTagsFromM2oParents(schema, rootCollection, fieldMap, records, fieldNames = /* @__PURE__ */ new Map()) {
	const pathsByCollection = /* @__PURE__ */ new Map();
	for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) {
		if (entry.collection === rootCollection) continue;
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
			const fields = scopedCacheUnaliasedPath(fieldNames, segments);
			const lastField = fields[fields.length - 1];
			let parentRows;
			if (resolveScopedCacheM2oJoinChainFromPath(schema, rootCollection, fields) !== null) parentRows = m2oParentRowsAtPathEnd(records, segments);
			else {
				const parentCollection = scopedCacheCollectionAtPathEnd(schema, rootCollection, fields.slice(0, -1));
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
*
* Every path to the child must pin, or none does: the rows another path nested —
* the same collection reached through an M2O, or through an o2m whose reverse fk
* is not scoped — lie outside every parent-key slice, and the M2O pinner declines
* a collection it shares with a to-many hop. Such a collection is reported through
* `conflictedOut`, since only the bare tag covers it.
*/
function pinnedScopedCacheTagsFromO2mChildren(schema, rootCollection, fieldMap, records, conflictedOut, fieldNames = /* @__PURE__ */ new Map()) {
	const keyingByChild = /* @__PURE__ */ new Map();
	const reachedUnpinnably = /* @__PURE__ */ new Set();
	const reachedByM2o = /* @__PURE__ */ new Map();
	for (const [path, entry] of [...fieldMap.read, ...fieldMap.other]) {
		const childCollection = entry.collection;
		if (childCollection === rootCollection) continue;
		const segments = path.split(".");
		const fields = scopedCacheUnaliasedPath(fieldNames, segments);
		const aliasField = fields[fields.length - 1];
		if (aliasField === void 0) continue;
		const prefix = segments.slice(0, -1);
		let parentCollection = rootCollection;
		if (prefix.length > 0) {
			const resolved = scopedCacheCollectionAtPathEnd(schema, rootCollection, fields.slice(0, -1));
			if (resolved === null) {
				reachedUnpinnably.add(childCollection);
				continue;
			}
			parentCollection = resolved;
		}
		const { relation, relationType } = getRelationInfo(schema.relations, parentCollection, aliasField);
		if (relationType === "m2o" && relation?.related_collection === childCollection) {
			const paths = reachedByM2o.get(childCollection) ?? /* @__PURE__ */ new Set();
			paths.add(path);
			reachedByM2o.set(childCollection, paths);
			continue;
		}
		if (relationType !== "o2m" || !relation || relation.collection !== childCollection) {
			reachedUnpinnably.add(childCollection);
			continue;
		}
		const reverseFk = relation.field;
		const parentPkField = schema.collections[parentCollection]?.primary;
		if (parentPkField === void 0) {
			reachedUnpinnably.add(childCollection);
			continue;
		}
		if (!scopedCacheO2mChildPinnedByParentKey(schema, childCollection, reverseFk)) {
			reachedUnpinnably.add(childCollection);
			continue;
		}
		const parentRows = prefix.length === 0 ? records : scopedCacheRowsAtPathEnd(records, prefix);
		if (parentRows === null) {
			reachedUnpinnably.add(childCollection);
			continue;
		}
		const fieldType = schema.collections[childCollection]?.fields[reverseFk]?.type;
		const keying = keyingByChild.get(childCollection) ?? {
			reverseFk,
			fieldType,
			rows: [],
			conflicted: false,
			prefixes: /* @__PURE__ */ new Set()
		};
		if (keying.reverseFk !== reverseFk) {
			keying.conflicted = true;
			keyingByChild.set(childCollection, keying);
			continue;
		}
		keying.prefixes.add(fields.slice(0, -1).join("."));
		for (const parentRow of parentRows) keying.rows.push(parentPkField in parentRow ? { [reverseFk]: parentRow[parentPkField] } : {});
		keyingByChild.set(childCollection, keying);
	}
	for (const [collection, paths] of reachedByM2o) {
		const keying = keyingByChild.get(collection);
		if (!(keying !== void 0 && [...paths].every((path) => {
			const segments = path.split(".");
			const rows = scopedCacheRowsAtPathEnd(records, segments);
			const fields = scopedCacheUnaliasedPath(fieldNames, segments);
			return keying.prefixes.has(`${fields.join(".")}.${keying.reverseFk}`) && rows !== null && rows.every((row) => row[keying.reverseFk] != null);
		}))) reachedUnpinnably.add(collection);
	}
	const pinned = /* @__PURE__ */ new Map();
	for (const [collection, keying] of keyingByChild) {
		const conflicted = keying.conflicted || reachedUnpinnably.has(collection);
		if (conflicted && conflictedOut) conflictedOut.add(collection);
		if (conflicted || keying.rows.length === 0) continue;
		const keyTags = scopedCacheTagsFromRows(collection, [keying.reverseFk], keying.rows, "coarse", { [keying.reverseFk]: keying.fieldType });
		if (keyTags !== null && keyTags.length <= scopedCacheMaxPinsPerCollection()) pinned.set(collection, keyTags);
	}
	return pinned;
}
function descendFilterSegment(node, segment) {
	if (segment in node) return node[segment];
	const some = node["_some"];
	return some !== null && typeof some === "object" ? some[segment] : void 0;
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
			node = descendFilterSegment(node, segments[i]);
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
* Whether a read path from the root walks one ownership chain BACKWARDS: from the
* root, one o2m hop per chain segment, each landing on the collection the segment
* below it is declared on, through the very fk that segment names. Every row
* nested that way holds the root row's key at the end of the chain, so the root's
* own pin bounds them all — the one way a would-be-bare child slices off the root.
*
* `chain` is read from `collection` upward (`['student', 'user']` on a course:
* `course.student` then `student.user`), so it must end on the root.
*/
function scopedCachePathReversesChain(schema, rootCollection, pathSegments, collection, chain) {
	const joins = resolveScopedCacheM2oJoinChainFromPath(schema, collection, chain);
	if (joins === null || joins.length !== pathSegments.length || joins[joins.length - 1]?.relatedCollection !== rootCollection) return false;
	const crossed = [collection, ...joins.map((join) => join.relatedCollection)];
	return pathSegments.every((alias, hop) => {
		const from = crossed[crossed.length - 1 - hop];
		const to = crossed[crossed.length - 2 - hop];
		const fk = chain[chain.length - 1 - hop];
		const { relation, relationType } = getRelationInfo(schema.relations, from, alias);
		return relationType === "o2m" && relation !== null && relation.collection === to && relation.field === fk;
	});
}

//#endregion
export { keyedFilterPinnable, pinnedScopedCacheTagsFromFilter, pinnedScopedCacheTagsFromKeyedFilters, pinnedScopedCacheTagsFromM2oParents, pinnedScopedCacheTagsFromO2mChildren, scopedCacheCollectionsBeyondNestedRows, scopedCacheFieldNamesByAliasedPath, scopedCacheNestedCollections, scopedCacheNodeBoundsByCollection, scopedCachePathReversesChain, scopedCacheRowsAtPathEnd, scopedCacheUnaliasedPath };