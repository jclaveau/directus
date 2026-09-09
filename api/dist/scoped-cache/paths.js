import { isPinnableScopeType } from "./tags.js";
import { joinFilterWithCases } from "../database/run-ast/lib/apply-query/join-filter-with-cases.js";
import { getRelationInfo } from "../utils/get-relation-info.js";
import { findRelatedCollection } from "../permissions/modules/process-ast/utils/find-related-collection.js";
import { hopsAcrossRelation, isFilterNode } from "../utils/filter-shape.js";
import { parseFilterKey } from "../utils/parse-filter-key.js";
import { expandRelatedKeyFilters } from "../utils/expand-related-key-filters.js";

//#region src/scoped-cache/paths.ts
/**
* Resolve a dotted path into the chain of M2O joins it crosses, from `collection`
* down. Null on anything that is not an M2O — a to-many hop, an unknown field, or an
* A2O, whose relation names no single related collection — and every caller then
* degrades to the bare collection tag.
*
* A row maps to exactly one parent across an M2O, so what such a join reaches is
* fully determined by the rows already in hand. Shared, so the two sides that ask
* "is this path pinnable?" cannot drift apart on the answer: a collection's declared
* scope paths, and the nested collections of a read.
*/
function resolveScopedCacheM2oJoinChainFromPath(schema, collection, path) {
	const joins = [];
	let current = collection;
	for (const field of path) {
		const relatedCollection = schema.relations.find((rel) => {
			return rel.collection === current && rel.field === field;
		})?.related_collection;
		const relatedPk = relatedCollection ? schema.collections[relatedCollection]?.primary : void 0;
		if (!relatedCollection || !relatedPk) return null;
		joins.push({
			field,
			relatedCollection,
			relatedPk
		});
		current = relatedCollection;
	}
	return joins;
}
/**
* Field paths to inject so a read's ownership ANCESTORS — the collections its
* scope chain crosses toward the owner — come back as rows and pin by key, not
* the bare tag a read that nested none of them (`fields: ['*']`) over-purges on.
*
* Walks the same flat-field M2O chain `composeScopedCachePaths` does: each
* collection names its parent, so ownership composes hop by hop. A path per
* intermediate ancestor, ending at that ancestor's own pk so it carries its key
* in the response (run-ast's linking pk is temporary and stripped). The terminal
* owner — no scope of its own — is the value slice's root, left un-nested.
*/
function scopedCacheOwnershipNestedPkPaths(schema, collection) {
	const paths = /* @__PURE__ */ new Set();
	const walk = (current, prefix, visited) => {
		if (visited.has(current)) return;
		const seen = new Set(visited).add(current);
		for (const field of schema.collections[current]?.scopedCacheFields ?? []) {
			if (field.includes(".")) continue;
			const target = schema.relations.find((rel) => {
				return rel.collection === current && rel.field === field;
			})?.related_collection;
			const targetPk = target ? schema.collections[target]?.primary : void 0;
			const targetHasScope = (schema.collections[target ?? ""]?.scopedCacheFields ?? []).length > 0;
			if (!target || !targetPk || !targetHasScope) continue;
			const targetPrefix = prefix === "" ? field : `${prefix}.${field}`;
			paths.add(`${targetPrefix}.${targetPk}`);
			walk(target, targetPrefix, seen);
		}
	};
	walk(collection, "", /* @__PURE__ */ new Set());
	const nested = [...paths];
	return nested.some((path) => path.split(".").length > 2) ? nested : [];
}
/**
* The parent rows sitting at the END of one M2O path, in document order — the set is
* replaced at every hop, so the rows passed through on the way out are not returned.
*
* Null when the response cannot answer the path — a segment it never carried, or an
* array where an M2O promised one row — so the caller falls back to the bare tag
* rather than pin a set it only half read.
*/
function m2oParentRowsAtPathEnd(records, segments) {
	let current = records;
	for (const segment of segments) {
		const next = [];
		for (const row of current) {
			const value = row[segment];
			if (value === null) continue;
			if (typeof value !== "object" || Array.isArray(value)) return null;
			next.push(value);
		}
		current = next;
	}
	return current;
}
const KEYING_UNKEYED = { kind: "unkeyed" };
const KEYING_ABSENT = { kind: "absent" };
function keyedAxisAcross(parts) {
	let field;
	const keys = /* @__PURE__ */ new Set();
	for (const part of parts) {
		if (part.kind !== "keyed" && part.kind !== "independent") continue;
		if (field !== void 0 && field !== part.field) return "conflict";
		field = part.field;
		for (const key of part.keys) keys.add(key);
	}
	if (field === void 0) return null;
	return {
		field,
		keys
	};
}
/**
* Conjunction. Every condition here describes the SAME joined row, so one of them
* naming that row's key pins it whatever the others go on to read off it:
* `{ _and: [{ course: { id: { _eq: 7 } } }, { course: { name: { _eq: 'x' } } }] }`
* compiles to one join alias, and only course 7 can satisfy it.
*/
function keyingOfEveryCondition(parts) {
	const axis = keyedAxisAcross(parts);
	if (axis === "conflict") return KEYING_UNKEYED;
	if (parts.some((part) => part.kind === "unkeyed")) return axis === null ? KEYING_UNKEYED : {
		kind: "keyed",
		field: axis.field,
		keys: axis.keys
	};
	if (axis !== null && parts.some((part) => part.kind === "keyed")) return {
		kind: "keyed",
		field: axis.field,
		keys: axis.keys
	};
	if (axis !== null && parts.some((part) => part.kind === "independent")) return {
		kind: "independent",
		field: axis.field,
		keys: axis.keys
	};
	return KEYING_ABSENT;
}
/**
* Disjunction. A row coming back through an unkeyed branch was reached through
* rows the filter never named, so one such branch takes the whole disjunction
* down; otherwise the keys are the union, since a row satisfies some branch. A
* branch that never mentions the collection contributes `absent`, not a
* fallback — it reads none of its rows.
*/
function keyingOfAnyCondition(parts) {
	if (parts.some((part) => part.kind === "unkeyed")) return KEYING_UNKEYED;
	const axis = keyedAxisAcross(parts);
	if (axis === "conflict") return KEYING_UNKEYED;
	if (axis !== null && parts.some((part) => part.kind === "keyed")) return {
		kind: "keyed",
		field: axis.field,
		keys: axis.keys
	};
	if (axis !== null && parts.some((part) => part.kind === "independent")) return {
		kind: "independent",
		field: axis.field,
		keys: axis.keys
	};
	return KEYING_ABSENT;
}
function combineKeyingByAlias(parts, combine) {
	const aliases = /* @__PURE__ */ new Set();
	for (const part of parts) for (const alias of part.keys()) aliases.add(alias);
	const combined = /* @__PURE__ */ new Map();
	for (const alias of aliases) {
		const atAlias = parts.map((part) => part.get(alias) ?? KEYING_ABSENT);
		combined.set(alias, combine(atAlias));
	}
	return combined;
}
/**
* The keys an M2O hop names when its conditions are answered by the near row's own
* foreign key column, so no row of the related collection is depended on — or null
* when the far row does have to be read.
*
* Three things have to hold. The relation must be an M2O, so the column is on this
* side. The conditions must name the related primary key and nothing else — a
* sibling on any other column has to read the far row. And the relation must carry
* a database constraint (`relation.schema`): without one a far row can be deleted
* behind the near row's back, leaving a foreign key that no longer joins, and the
* result changes with nothing written on this side.
*
* The constraint is taken to be enforced for the rows already there. A Postgres
* foreign key added `NOT VALID` reports as a constraint while tolerating the
* orphans that predate it, and would make this verdict wrong — Directus creates
* no such constraint, and the schema snapshot does not carry its validity.
*/
function nearRowAnswerKeys(schema, collection, fieldName, conditions) {
	const { relation, relationType } = getRelationInfo(schema.relations, collection, fieldName);
	if (relationType !== "m2o" || !relation?.schema || !relation.related_collection) return null;
	const relatedPrimaryKey = schema.collections[relation.related_collection]?.primary;
	const named = Object.keys(conditions);
	if (relatedPrimaryKey === void 0 || named.length !== 1) return null;
	if (named[0] !== relatedPrimaryKey) return null;
	const terminal = conditions[relatedPrimaryKey];
	if (terminal === null || typeof terminal !== "object" || Array.isArray(terminal)) return null;
	const operators = terminal;
	if (!Object.keys(operators).every((child) => child.startsWith("_"))) return null;
	if ("_eq" in operators) return new Set([operators["_eq"]]);
	if ("_in" in operators && Array.isArray(operators["_in"])) return new Set(operators["_in"]);
	return /* @__PURE__ */ new Set();
}
/**
* Walk one filter and report, per join alias, what it says about the rows it
* reaches. `collectionByAlias` is filled as the walk crosses relations, so the
* caller can fold aliases back onto the collections they name.
*
* Every hop is followed, not only the M2O ones
* `resolveScopedCacheM2oJoinChainFromPath` accepts: what a hop reaches at its FAR
* end is named by the key the condition
* gives, whichever direction the relation runs. `filter/index.ts` joins O2M, M2M
* and A2O the same way it joins M2O, and `_some`/`_none` push the same condition
* into a subquery over the same one row.
*/
function scopedCacheFilterKeyingByAlias(schema, collection, filter, alias, collectionByAlias) {
	collectionByAlias.set(alias, collection);
	const parts = [];
	const unkeyEverythingUnder = (node) => {
		const swept = scopedCacheFilterKeyingByAlias(schema, collection, node, alias, collectionByAlias);
		for (const sweptAlias of swept.keys()) parts.push(new Map([[sweptAlias, KEYING_UNKEYED]]));
		parts.push(new Map([[alias, KEYING_UNKEYED]]));
	};
	for (const [key, value] of Object.entries(filter)) {
		if ((key === "_and" || key === "_or") && Array.isArray(value)) {
			parts.push(combineKeyingByAlias(value.map((branch) => {
				return scopedCacheFilterKeyingByAlias(schema, collection, branch, alias, collectionByAlias);
			}), key === "_and" ? keyingOfEveryCondition : keyingOfAnyCondition));
			continue;
		}
		if ((key === "_some" || key === "_none") && isFilterNode(value)) {
			parts.push(scopedCacheFilterKeyingByAlias(schema, collection, value, alias, collectionByAlias));
			continue;
		}
		if (key.startsWith("_")) {
			if (isFilterNode(value)) unkeyEverythingUnder(value);
			else parts.push(new Map([[alias, KEYING_UNKEYED]]));
			continue;
		}
		if (isFilterNode(value) === false) {
			parts.push(new Map([[alias, KEYING_UNKEYED]]));
			continue;
		}
		const conditions = value;
		const [pathField, pathScope] = key.split(":");
		const { fieldName, functionName } = parseFilterKey(pathField);
		if (pathScope !== void 0 && schema.collections[pathScope] === void 0) {
			parts.push(new Map([[alias, KEYING_UNKEYED]]));
			continue;
		}
		const relatedCollection = pathScope ?? findRelatedCollection(collection, fieldName, schema);
		const childAlias = alias === "" ? key : `${alias}.${key}`;
		if (relatedCollection !== null && functionName !== void 0) {
			collectionByAlias.set(childAlias, relatedCollection);
			parts.push(new Map([[childAlias, KEYING_UNKEYED]]));
			parts.push(new Map([[alias, KEYING_UNKEYED]]));
			continue;
		}
		if (relatedCollection !== null && hopsAcrossRelation(conditions)) {
			const nearRowKeys = nearRowAnswerKeys(schema, collection, fieldName, conditions);
			if (nearRowKeys !== null) {
				collectionByAlias.set(childAlias, relatedCollection);
				const relatedPrimaryKey = schema.collections[relatedCollection]?.primary ?? "";
				parts.push(new Map([[childAlias, {
					kind: "independent",
					field: relatedPrimaryKey,
					keys: nearRowKeys
				}]]));
				parts.push(new Map([[alias, isScopedCacheKeyableField(schema, collection, fieldName) ? {
					kind: "keyed",
					field: fieldName,
					keys: nearRowKeys
				} : KEYING_UNKEYED]]));
				continue;
			}
			parts.push(scopedCacheFilterKeyingByAlias(schema, relatedCollection, conditions, childAlias, collectionByAlias));
			parts.push(new Map([[alias, KEYING_UNKEYED]]));
			continue;
		}
		parts.push(new Map([[alias, keyingOfColumnConditions(schema, collection, fieldName, functionName, conditions)]]));
	}
	return combineKeyingByAlias(parts, keyingOfEveryCondition);
}
/**
* What one column's conditions say about the rows they can match. Only the
* primary key under `_eq`/`_in` names them: any other column matches rows by a
* value a write can move onto a row this read never saw, and any other operator
* describes rows by what they are NOT. A function key (`year(created_on)`)
* reads the column through a transform, so it names nothing either.
*
* An empty `_in` matches no row and so depends on none, but it is reported
* unkeyed rather than as an empty key set: pinning a collection to nothing would
* drop its tag altogether, and a bare tag is the cheaper way to be right about a
* query that returns nothing.
*/
function isScopedCacheKeyableField(schema, collection, fieldName) {
	const scopedFlatFields = (schema.collections[collection]?.scopedCacheFields ?? []).filter((field) => !field.includes("."));
	if (fieldName !== schema.collections[collection]?.primary && !scopedFlatFields.includes(fieldName)) return false;
	const keyType = schema.collections[collection]?.fields[fieldName]?.type;
	return isPinnableScopeType(keyType);
}
function keyingOfColumnConditions(schema, collection, fieldName, functionName, conditions) {
	if (functionName !== void 0 || !isScopedCacheKeyableField(schema, collection, fieldName)) return KEYING_UNKEYED;
	if ("_eq" in conditions) return {
		kind: "keyed",
		field: fieldName,
		keys: new Set([conditions["_eq"]])
	};
	if ("_in" in conditions && Array.isArray(conditions["_in"])) {
		const keys = new Set(conditions["_in"]);
		if (keys.size > 0) return {
			kind: "keyed",
			field: fieldName,
			keys
		};
	}
	return KEYING_UNKEYED;
}
/**
* What every filter a read carries says about each collection it joins to — the
* root query's, and every nested node's, each with the permission cases folded in
* the way the SQL WHERE folds them.
*
* Aliases are folded back onto collections by the disjunction rule: two paths to
* one collection join two independent rows, so one unkeyed path leaves every row
* of that collection able to change the result, and otherwise the keys are the
* union of what each path named. Each node folds its own aliases, since alias
* `''` means a different collection in every one of them.
*
* Shared by the two sides that must agree on it — the tags a keyed collection
* pins, and the collections that consequently need NOT fall back to the bare tag
* — so neither can drift from the other's answer.
*/
function scopedCacheFilterKeyingByCollection(schema, ast) {
	const keyingByCollection = /* @__PURE__ */ new Map();
	const readKeyingOf = (collection, query, cases) => {
		const filter = joinFilterWithCases(query.filter, cases);
		if (!filter) return;
		const collectionByAlias = /* @__PURE__ */ new Map();
		const keyingByAlias = scopedCacheFilterKeyingByAlias(schema, collection, expandRelatedKeyFilters(schema, collection, filter), "", collectionByAlias);
		for (const [alias, keying] of keyingByAlias) {
			const aliasCollection = collectionByAlias.get(alias);
			if (aliasCollection === void 0) continue;
			const known = keyingByCollection.get(aliasCollection) ?? KEYING_ABSENT;
			keyingByCollection.set(aliasCollection, keyingOfAnyCondition([known, keying]));
		}
	};
	readKeyingOf(ast.name, ast.query, ast.cases);
	const readKeyingOfChildren = (children) => {
		for (const child of children) {
			if (child.type === "field") continue;
			if (child.type === "functionField") {
				readKeyingOf(child.relatedCollection, child.query, child.cases);
				continue;
			}
			if (child.type === "a2o") {
				for (const name of child.names) {
					readKeyingOf(name, child.query[name] ?? {}, child.cases[name] ?? []);
					readKeyingOfChildren(child.children[name] ?? []);
				}
				continue;
			}
			readKeyingOf(child.name, child.query, child.cases);
			readKeyingOfChildren(child.children);
		}
	};
	readKeyingOfChildren(ast.children);
	return keyingByCollection;
}
/**
* Auto-derive multi-hop scope paths from LOCAL scope fields, so each collection
* declares only its own column and the grand-owner path composes itself. A scope
* field on `collection` that is an M2O to a collection which itself declares scope
* fields contributes `<field>.<targetScope>` for each of the target's scopes — its
* own and, transitively, its derived. So `team` scoped by `owner_ref` + `member`
* scoped by `team` yields `team.owner_ref`, no config naming another collection's
* relation. Cycle-guarded (`visited`); the caller re-resolves each path (a to-many
* hop drops to the bare tag).
*/
function composeScopedCachePaths(schema, collection, visited = /* @__PURE__ */ new Set()) {
	if (visited.has(collection)) return [];
	const seen = new Set(visited).add(collection);
	const localFields = schema.collections[collection]?.scopedCacheFields ?? [];
	const composed = [];
	for (const field of localFields) {
		if (field.includes(".")) continue;
		const target = schema.relations.find((rel) => {
			return rel.collection === collection && rel.field === field;
		})?.related_collection;
		if (!target) continue;
		for (const targetField of schema.collections[target]?.scopedCacheFields ?? []) composed.push({
			field: `${field}.${targetField}`,
			segments: [field, ...targetField.split(".")]
		});
		for (const deeper of composeScopedCachePaths(schema, target, seen)) composed.push({
			field: `${field}.${deeper.field}`,
			segments: [field, ...deeper.segments]
		});
	}
	return composed;
}

//#endregion
export { composeScopedCachePaths, m2oParentRowsAtPathEnd, resolveScopedCacheM2oJoinChainFromPath, scopedCacheFilterKeyingByCollection, scopedCacheOwnershipNestedPkPaths };