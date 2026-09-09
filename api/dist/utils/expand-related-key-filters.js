import { getRelationInfo } from "./get-relation-info.js";
import { hopsAcrossRelation, isFilterNode } from "./filter-shape.js";
import { parseFilterKey } from "./parse-filter-key.js";

//#region src/utils/expand-related-key-filters.ts
/**
* Rewrite a filter into the one shape the SQL builder ends up reading, so a
* consumer that has to reason about which rows a filter reaches does not have to
* re-derive it.
*
* Two spellings collapse:
*
* - A leaf carrying no operator becomes `_eq`, which is how `getOperation` reads
*   it: `{ id: 7 }` and `{ id: { _eq: 7 } }` compile identically.
* - An operator sitting directly on a to-many alias becomes an operator on the
*   RELATED primary key, which is what `getColumnPath` does when a path ends on an
*   alias field (`addNestedPkField`): `{ items: { _eq: 7 } }` reads
*   `{ items: { id: { _eq: 7 } } }`, and both join the related table.
*
* The M2O direction is deliberately left alone. There the foreign key is a column
* of THIS collection, so `{ owner: { _eq: 7 } }` compiles to `owner = ?` with no
* join and reads no row of the related collection — expanding it would invent a
* dependency that the query does not have.
*
* Structural only: no condition is added, removed or reordered, and the result is
* a new object — the caller's filter is never mutated. It is NOT written back onto
* the AST, because the field map drives permission validation and would then start
* naming collections the shorthand does not name today.
*/
function expandRelatedKeyFilters(schema, collection, filter) {
	const expanded = {};
	for (const [key, value] of Object.entries(filter)) {
		if ((key === "_and" || key === "_or") && Array.isArray(value)) {
			expanded[key] = value.map((branch) => {
				return expandRelatedKeyFilters(schema, collection, branch);
			});
			continue;
		}
		if ((key === "_some" || key === "_none") && isFilterNode(value)) {
			expanded[key] = expandRelatedKeyFilters(schema, collection, value);
			continue;
		}
		if (key.startsWith("_")) {
			expanded[key] = value;
			continue;
		}
		const conditions = isFilterNode(value) ? value : { _eq: value };
		const [pathField, pathScope] = key.split(":");
		const { fieldName, functionName } = parseFilterKey(pathField);
		const { relation, relationType } = getRelationInfo(schema.relations, collection, fieldName);
		if (!relation) {
			expanded[key] = conditions;
			continue;
		}
		const relatedCollection = pathScope ?? (relationType === "o2m" ? relation.collection : relation.related_collection);
		if (!relatedCollection) {
			expanded[key] = conditions;
			continue;
		}
		if (hopsAcrossRelation(conditions)) {
			expanded[key] = expandRelatedKeyFilters(schema, relatedCollection, conditions);
			continue;
		}
		const relatedPrimaryKey = schema.collections[relatedCollection]?.primary;
		if (functionName !== void 0 || relationType !== "o2m" || relatedPrimaryKey === void 0) {
			expanded[key] = conditions;
			continue;
		}
		expanded[key] = { [relatedPrimaryKey]: conditions };
	}
	return expanded;
}

//#endregion
export { expandRelatedKeyFilters };