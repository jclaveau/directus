import { joinFilterWithCases } from "./join-filter-with-cases.js";
import { applyCaseWhen } from "../../utils/apply-case-when.js";
import { getColumn } from "../../utils/get-column.js";
import { applyLimit, applyOffset } from "./pagination.js";
import { applySort } from "./sort.js";
import { applySearch } from "./search.js";
import { applyAggregate } from "./aggregate.js";
import { applyFilter } from "./filter/index.js";
import { getHelpers } from "../../../helpers/index.js";

//#region src/database/run-ast/lib/apply-query/index.ts
/**
* Apply the Query to a given Knex query builder instance
*/
function applyQuery(knex, collection, dbQuery, query, schema, cases, permissions, generateAlias, options) {
	const aliasMap = options?.aliasMap ?? Object.create(null);
	let hasJoins = false;
	let hasMultiRelationalFilter = false;
	applyLimit(knex, dbQuery, query.limit);
	if (query.offset) applyOffset(knex, dbQuery, query.offset);
	if (query.page && query.limit && query.limit !== -1) applyOffset(knex, dbQuery, query.limit * (query.page - 1));
	if (query.sort && !options?.isInnerQuery && !options?.hasMultiRelationalSort) {
		const sortResult = applySort(knex, schema, dbQuery, query.sort, query.aggregate, collection, aliasMap, generateAlias);
		if (!hasJoins) hasJoins = sortResult.hasJoins;
	}
	const filter = options?.filteredInSubquery ? null : joinFilterWithCases(query.filter, cases);
	if (filter) {
		const filterResult = applyFilter(knex, schema, dbQuery, filter, collection, aliasMap, cases, permissions, generateAlias);
		if (!hasJoins) hasJoins = filterResult.hasJoins;
		hasMultiRelationalFilter = filterResult.hasMultiRelationalFilter;
	}
	if (query.group) {
		const helpers = getHelpers(knex);
		const rawColumns = query.group.map((column) => {
			return getColumn(knex, collection, column, false, schema, { generateAlias });
		});
		let columns;
		if (options?.groupWhenCases) {
			if (helpers.capabilities.supportsColumnPositionInGroupBy() && options.groupColumnPositions) columns = query.group.map((column, index) => options.groupColumnPositions[index] !== void 0 ? knex.raw(options.groupColumnPositions[index]) : column);
			else columns = rawColumns.map((column, index) => applyCaseWhen({
				columnCases: options.groupWhenCases[index].map((caseIndex) => cases[caseIndex]),
				column,
				aliasMap,
				cases,
				table: collection,
				permissions,
				generateAlias,
				readsCasesByKey: options?.filteredInSubquery
			}, {
				knex,
				schema
			}));
			if (query.sort && query.sort.length === 1 && query.sort[0] === query.group[0]) {
				dbQuery.clear("order");
				let order = "asc";
				if (query.sort[0].startsWith("-")) order = "desc";
				dbQuery.orderBy([{
					column: columns[0],
					order
				}]);
			}
		} else columns = rawColumns;
		dbQuery.groupBy(columns);
	}
	if (query.search && !options?.filteredInSubquery) applySearch(knex, schema, dbQuery, query.search, collection, aliasMap, permissions, generateAlias);
	if (query.aggregate) applyAggregate(schema, dbQuery, query.aggregate, collection, hasJoins);
	return {
		query: dbQuery,
		hasJoins,
		hasMultiRelationalFilter
	};
}

//#endregion
export { applyQuery as default };