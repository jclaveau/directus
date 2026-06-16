import { getCases } from "../../../../../permissions/modules/process-ast/lib/get-cases.js";
import { getColumnPath } from "../../../../../utils/get-column-path.js";
import { addJoin } from "../add-join.js";
import { getFilterPath } from "../get-filter-path.js";
import { getOperation } from "../get-operation.js";
import applyQuery from "../index.js";
import { getFilterType } from "./get-filter-type.js";
import { applyOperator } from "./operator.js";
import { validateOperator } from "./validate-operator.js";
import { getHelpers } from "../../../../helpers/index.js";
import { InvalidQueryError } from "@directus/errors";
import { getRelationInfo } from "@directus/utils";

//#region src/database/run-ast/lib/apply-query/filter/index.ts
function applyFilter(knex, schema, rootQuery, rootFilter, collection, aliasMap, cases, permissions) {
	const relations = schema.relations;
	let hasJoins = false;
	let hasMultiRelationalFilter = false;
	addJoins(rootQuery, rootFilter, collection);
	addWhereClauses(knex, rootQuery, rootFilter, collection);
	return {
		query: rootQuery,
		hasJoins,
		hasMultiRelationalFilter
	};
	function addJoins(dbQuery, filter, collection$1) {
		for (let [key, value] of Object.entries(filter)) {
			if (key === "_or" || key === "_and") {
				if (key === "_or" && value.some((subFilter) => Object.keys(subFilter).length === 0)) if (value !== cases || value.length === 1) continue;
				else value = value.filter((subFilter) => Object.keys(subFilter).length > 0);
				value.forEach((subFilter) => {
					addJoins(dbQuery, subFilter, collection$1);
				});
				continue;
			}
			const filterPath = getFilterPath(key, value);
			if (filterPath.length > 1 || !(key.includes("(") && key.includes(")")) && schema.collections[collection$1]?.fields[key]?.type === "alias") {
				const { hasMultiRelational, isJoinAdded } = addJoin({
					path: filterPath,
					collection: collection$1,
					knex,
					schema,
					rootQuery,
					aliasMap
				});
				if (!hasJoins) hasJoins = isJoinAdded;
				if (!hasMultiRelationalFilter) hasMultiRelationalFilter = hasMultiRelational;
			}
		}
	}
	function addWhereClauses(knex$1, dbQuery, filter, collection$1, logical = "and") {
		for (const [key, value] of Object.entries(filter)) {
			if (key === "_or" || key === "_and") {
				if (key === "_or" && value.some((subFilter) => Object.keys(subFilter).length === 0)) continue;
				/** @NOTE this callback function isn't called until Knex runs the query */
				dbQuery[logical].where((subQuery) => {
					value.forEach((subFilter) => {
						addWhereClauses(knex$1, subQuery, subFilter, collection$1, key === "_and" ? "and" : "or");
					});
				});
				continue;
			}
			const filterPath = getFilterPath(key, value);
			/**
			* For A2M fields, the path can contain an optional collection scope <field>:<scope>
			*/
			const pathRoot = filterPath[0].split(":")[0];
			const { relation, relationType } = getRelationInfo(relations, collection$1, pathRoot);
			const operation = getOperation(key, value);
			if (!operation) continue;
			const { operator: filterOperator, value: filterValue } = operation;
			if (filterPath.length > 1 || !(key.includes("(") && key.includes(")")) && schema.collections[collection$1]?.fields[key]?.type === "alias") {
				if (!relation) continue;
				if (relationType === "o2m" || relationType === "o2a") {
					let pkField = `${collection$1}.${schema.collections[relation.related_collection].primary}`;
					if (relationType === "o2a") pkField = knex$1.raw(getHelpers(knex$1).schema.castA2oPrimaryKey(), [pkField]);
					const childKey = Object.keys(value)?.[0];
					if (childKey === "_none" || childKey === "_some") {
						const subQueryBuilder = (filter$1, cases$1) => (subQueryKnex) => {
							const field = relation.field;
							const collection$2 = relation.collection;
							const column = `${collection$2}.${field}`;
							subQueryKnex.select({ [field]: column }).from(collection$2).whereNotNull(column);
							applyQuery(knex$1, relation.collection, subQueryKnex, { filter: filter$1 }, schema, cases$1, permissions);
						};
						const { cases: subCases } = getCases(relation.collection, permissions, []);
						if (childKey === "_none") {
							dbQuery[logical].whereNotIn(pkField, subQueryBuilder(Object.values(value)[0], subCases));
							continue;
						} else if (childKey === "_some") {
							dbQuery[logical].whereIn(pkField, subQueryBuilder(Object.values(value)[0], subCases));
							continue;
						}
					}
				}
				if (filterPath.includes("_none") || filterPath.includes("_some")) throw new InvalidQueryError({ reason: `"${filterPath.includes("_none") ? "_none" : "_some"}" can only be used with top level relational alias field` });
				const { columnPath, targetCollection, addNestedPkField } = getColumnPath({
					path: filterPath,
					collection: collection$1,
					relations,
					aliasMap,
					schema
				});
				if (addNestedPkField) filterPath.push(addNestedPkField);
				if (!columnPath) continue;
				const { type, special } = getFilterType(schema.collections[targetCollection].fields, filterPath.at(-1), targetCollection);
				validateOperator(type, filterOperator, special);
				applyOperator(knex$1, dbQuery, schema, columnPath, filterOperator, filterValue, logical, targetCollection);
			} else {
				const { type, special } = getFilterType(schema.collections[collection$1].fields, filterPath[0], collection$1);
				validateOperator(type, filterOperator, special);
				applyOperator(knex$1, dbQuery, schema, `${aliasMap[""]?.alias || collection$1}.${filterPath[0]}`, filterOperator, filterValue, logical, collection$1);
			}
		}
	}
}

//#endregion
export { applyFilter };