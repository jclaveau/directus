import { applyCaseWhen } from "../../utils/apply-case-when.js";
import { getAggregateFieldCases } from "../../../../permissions/modules/process-ast/lib/aggregate-field-cases.js";

//#region src/database/run-ast/lib/apply-query/aggregate.ts
const aggregateSqlByOperation = new Map([
	["count", "count(?)"],
	["countDistinct", "count(distinct ?)"],
	["avg", "avg(?)"],
	["avgDistinct", "avg(distinct ?)"],
	["sum", "sum(?)"],
	["sumDistinct", "sum(distinct ?)"],
	["min", "min(?)"],
	["max", "max(?)"]
]);
function applyAggregate(schema, dbQuery, aggregate, collection, hasJoins, caseOptions) {
	for (const [operation, fields] of Object.entries(aggregate)) {
		if (!fields) continue;
		for (const field of fields) {
			if (operation === "countAll") {
				dbQuery.count("*", { as: "countAll" });
				continue;
			}
			if (operation === "count" && field === "*") {
				dbQuery.count("*", { as: "count" });
				continue;
			}
			const countsRowsRead = ["count", "countDistinct"].includes(operation) && (field === "*" || schema.collections[collection]?.primary === field);
			const fieldCases = caseOptions && !countsRowsRead ? getAggregateFieldCases(collection, field, caseOptions) : [];
			const aggregateSql = aggregateSqlByOperation.get(operation);
			if (caseOptions && aggregateSql && fieldCases.length > 0) {
				const { knex, cases, permissions, generateAlias } = caseOptions;
				const casedColumn = applyCaseWhen({
					column: knex.raw("??.??", [collection, field]),
					columnCases: fieldCases,
					table: collection,
					cases,
					aliasMap: Object.create(null),
					permissions,
					generateAlias,
					readsCasesByKey: true
				}, {
					knex,
					schema
				});
				dbQuery.select(knex.raw(`${aggregateSql} as ??`, [casedColumn, `${operation}->${field}`]));
				continue;
			}
			if (operation === "countDistinct" && !hasJoins && schema.collections[collection]?.primary === field) {
				dbQuery.count(`${collection}.${field}`, { as: `countDistinct->${field}` });
				continue;
			}
			if ([
				"count",
				"countDistinct",
				"avg",
				"avgDistinct",
				"sum",
				"sumDistinct",
				"min",
				"max"
			].includes(operation)) dbQuery[operation](`${collection}.${field}`, { as: `${operation}->${field}` });
		}
	}
}

//#endregion
export { applyAggregate };