import { getColumnPath } from "../../../../utils/get-column-path.js";
import { addJoin } from "./add-join.js";
import { getColumn } from "../../utils/get-column.js";
import { extractFunctionName } from "../../../../utils/extract-function-name.js";
import { splitFieldPath } from "../../../../utils/split-field-path.js";
import { getRelationInfo } from "@directus/utils";

//#region src/database/run-ast/lib/apply-query/sort.ts
function applySort(knex, schema, rootQuery, sort, collection, aliasMap, options) {
	const { aggregate, returnRecords = false, fieldAliasMap } = options ?? {};
	const relations = schema.relations;
	let hasJoins = false;
	let hasMultiRelationalSort = false;
	const sortRecords = sort.map((sortField) => {
		const column = splitFieldPath(sortField);
		let order = "asc";
		if (sortField.startsWith("-")) order = "desc";
		if (column[0].startsWith("-")) column[0] = column[0].substring(1);
		if (Object.keys(aggregate ?? {}).includes(column[0])) {
			const operation = column[0];
			const field$1 = column[1];
			if (operation === "countAll") return {
				order,
				column: "countAll"
			};
			if (operation === "count" && (field$1 === "*" || !field$1)) return {
				order,
				column: "count"
			};
			return {
				order,
				column: returnRecords ? column[0] : `${operation}->${field$1}`
			};
		}
		if (column.length === 1) {
			const rawField = column[0];
			const resolvedField = fieldAliasMap?.[rawField] ?? rawField;
			if (extractFunctionName(resolvedField) === "json") return {
				order,
				column: returnRecords ? resolvedField : getColumn(knex, collection, resolvedField, false, schema, { jsonReturnType: "text" })
			};
			const pathRoot = resolvedField.split(":")[0];
			const { relation, relationType } = getRelationInfo(relations, collection, pathRoot);
			if (!relation || ["m2o", "a2o"].includes(relationType ?? "")) return {
				order,
				column: returnRecords ? resolvedField : getColumn(knex, collection, resolvedField, false, schema)
			};
		}
		const { hasMultiRelational, isJoinAdded } = addJoin({
			path: column,
			collection,
			aliasMap,
			rootQuery,
			schema,
			knex
		});
		const { columnPath, targetCollection } = getColumnPath({
			path: column,
			collection,
			aliasMap,
			relations,
			schema
		});
		const [alias, ...rest] = splitFieldPath(columnPath);
		const field = rest.join(".");
		if (!hasJoins) hasJoins = isJoinAdded;
		if (!hasMultiRelationalSort) hasMultiRelationalSort = hasMultiRelational;
		return {
			order,
			column: returnRecords ? columnPath : getColumn(knex, alias, field, false, schema, { originalCollectionName: targetCollection })
		};
	});
	if (returnRecords) return {
		sortRecords,
		hasJoins,
		hasMultiRelationalSort
	};
	rootQuery.clear("order");
	rootQuery.orderBy(sortRecords);
	return {
		hasJoins,
		hasMultiRelationalSort
	};
}

//#endregion
export { applySort };