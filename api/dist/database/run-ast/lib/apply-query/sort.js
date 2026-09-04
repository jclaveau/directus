import { getRelationInfo } from "../../../../utils/get-relation-info.js";
import { getColumnPath } from "../../../../utils/get-column-path.js";
import { addJoin } from "./add-join.js";
import { getColumn } from "../../utils/get-column.js";

//#region src/database/run-ast/lib/apply-query/sort.ts
function applySort(knex, schema, rootQuery, sort, aggregate, collection, aliasMap, returnRecords = false) {
	const relations = schema.relations;
	let hasJoins = false;
	let hasMultiRelationalSort = false;
	const sortRecords = sort.map((sortField) => {
		const column = sortField.split(".");
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
			const pathRoot = column[0].split(":")[0];
			const { relation, relationType } = getRelationInfo(relations, collection, pathRoot);
			if (!relation || ["m2o", "a2o"].includes(relationType ?? "")) return {
				order,
				column: returnRecords ? column[0] : getColumn(knex, collection, column[0], false, schema)
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
		const { columnPath } = getColumnPath({
			path: column,
			collection,
			aliasMap,
			relations,
			schema
		});
		const [alias, field] = columnPath.split(".");
		if (!hasJoins) hasJoins = isJoinAdded;
		if (!hasMultiRelationalSort) hasMultiRelationalSort = hasMultiRelational;
		return {
			order,
			column: returnRecords ? columnPath : getColumn(knex, alias, field, false, schema)
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