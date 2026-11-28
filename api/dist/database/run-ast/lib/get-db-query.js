import { cloneDeep } from "../../../utils/lodash-es-used.js";
import { applyCaseWhen } from "../utils/apply-case-when.js";
import { getColumn } from "../utils/get-column.js";
import { applyLimit } from "./apply-query/pagination.js";
import { applySort } from "./apply-query/sort.js";
import applyQuery from "./apply-query/index.js";
import { getHelpers } from "../../helpers/index.js";
import { getCollectionFromAlias } from "../../../utils/get-collection-from-alias.js";
import { getNodeAlias } from "../utils/get-field-alias.js";
import { getColumnPreprocessor } from "../utils/get-column-pre-processor.js";
import { getInnerQueryColumnPreProcessor } from "../utils/get-inner-query-column-pre-processor.js";
import { withPreprocessBindings } from "../utils/with-preprocess-bindings.js";
import { createAliasGenerator } from "./apply-query/create-alias-generator.js";
import { useEnv } from "@directus/env";

//#region src/database/run-ast/lib/get-db-query.ts
function getDBQuery({ table, fieldNodes, o2mNodes, query, cases, permissions, permissionsOnly }, { knex, schema }) {
	const aliasMap = Object.create(null);
	const generateAlias = createAliasGenerator();
	const env = useEnv();
	const preProcess = getColumnPreprocessor(knex, schema, table, cases, permissions, aliasMap, generateAlias, permissionsOnly);
	const queryCopy = cloneDeep(query);
	const helpers = getHelpers(knex);
	const hasCaseWhen = o2mNodes.some((node) => node.whenCase && node.whenCase.length > 0) || fieldNodes.some((node) => node.whenCase && node.whenCase.length > 0);
	queryCopy.limit = typeof queryCopy.limit === "number" ? queryCopy.limit : Number(env["QUERY_LIMIT_DEFAULT"]);
	if (queryCopy.aggregate || queryCopy.group) {
		const flatQuery = knex.from(table);
		const keyColumn = `${table}.${schema.collections[table].primary}`;
		const matchingQuery = {
			filter: queryCopy.filter ?? null,
			search: queryCopy.search ?? null
		};
		const { hasMultiRelationalFilter: filtersThroughChildren } = applyQuery(knex, table, knex.from(table), matchingQuery, schema, cases, permissions, createAliasGenerator());
		if (filtersThroughChildren) {
			const matchedKeys = knex.from(table).distinct(keyColumn);
			applyQuery(knex, table, matchedKeys, matchingQuery, schema, cases, permissions, generateAlias);
			flatQuery.whereIn(keyColumn, matchedKeys);
		}
		const fieldNodeMap = Object.fromEntries(fieldNodes.map((node, index) => [node.fieldKey, [node, index]]));
		const groupFieldNodes = queryCopy.group?.map((field) => fieldNodeMap[field][0]) ?? [];
		const groupWhenCases = hasCaseWhen ? groupFieldNodes.map((node) => node.whenCase ?? []) : void 0;
		const aggregateCount = Object.entries(queryCopy.aggregate ?? {}).reduce((acc, [_, fields]) => acc + fields.length, 0);
		const dbQuery$1 = applyQuery(knex, table, flatQuery, queryCopy, schema, cases, permissions, generateAlias, {
			aliasMap,
			groupWhenCases,
			groupColumnPositions: queryCopy.group?.map((field) => fieldNodeMap[field][1] + 1 + aggregateCount) ?? [],
			filteredInSubquery: filtersThroughChildren
		}).query;
		flatQuery.select(fieldNodes.map((node) => {
			return preProcess(node, { readsCasesByKey: filtersThroughChildren });
		}));
		if (helpers.capabilities.supportsDeduplicationOfParameters() && !helpers.capabilities.supportsColumnPositionInGroupBy()) withPreprocessBindings(knex, dbQuery$1);
		return dbQuery$1;
	}
	const primaryKey = schema.collections[table].primary;
	const dbQuery = knex.from(table);
	let sortRecords;
	const innerQuerySortRecords = [];
	let hasMultiRelationalSort;
	if (queryCopy.sort) {
		const sortResult = applySort(knex, schema, dbQuery, queryCopy.sort, queryCopy.aggregate, table, aliasMap, generateAlias, true);
		if (sortResult) {
			sortRecords = sortResult.sortRecords;
			hasMultiRelationalSort = sortResult.hasMultiRelationalSort;
		}
	}
	const { hasMultiRelationalFilter } = applyQuery(knex, table, dbQuery, queryCopy, schema, cases, permissions, generateAlias, {
		aliasMap,
		isInnerQuery: true,
		hasMultiRelationalSort
	});
	const needsInnerQuery = hasMultiRelationalSort || hasMultiRelationalFilter;
	if (needsInnerQuery) {
		dbQuery.select(`${table}.${primaryKey}`);
		if (!hasCaseWhen) dbQuery.distinct();
	} else {
		dbQuery.select(fieldNodes.map((node) => preProcess(node)));
		dbQuery.select(o2mNodes.filter((node) => node.whenCase && node.whenCase.length > 0).map((node) => {
			const columnCases = node.whenCase.map((index) => cases[index]);
			return applyCaseWhen({
				column: knex.raw(1),
				columnCases,
				aliasMap,
				cases,
				table,
				alias: node.fieldKey,
				permissions,
				generateAlias
			}, {
				knex,
				schema
			});
		}));
	}
	if (sortRecords) {
		dbQuery.clear("order");
		if (needsInnerQuery) {
			let orderByString = "";
			const orderByFields = [];
			sortRecords.map((sortRecord) => {
				if (orderByString.length !== 0) orderByString += ", ";
				const sortAlias = `sort_${generateAlias()}`;
				let orderByColumn;
				if (sortRecord.column.includes(".")) {
					const [alias, field] = sortRecord.column.split(".");
					const originalCollectionName = getCollectionFromAlias(alias, aliasMap);
					dbQuery.select(getColumn(knex, alias, field, sortAlias, schema, {
						originalCollectionName,
						generateAlias
					}));
					orderByString += `?? ${sortRecord.order}`;
					orderByColumn = getColumn(knex, alias, field, false, schema, {
						originalCollectionName,
						generateAlias
					});
				} else {
					dbQuery.select(getColumn(knex, table, sortRecord.column, sortAlias, schema, { generateAlias }));
					orderByString += `?? ${sortRecord.order}`;
					orderByColumn = getColumn(knex, table, sortRecord.column, false, schema, { generateAlias });
				}
				orderByFields.push(orderByColumn);
				innerQuerySortRecords.push({
					alias: sortAlias,
					order: sortRecord.order,
					column: orderByColumn
				});
			});
			if (hasMultiRelationalSort) {
				dbQuery.rowNumber("directus_row_number", knex.raw(`partition by ?? order by ${orderByString}`, [`${table}.${primaryKey}`, ...orderByFields]));
				orderByString = `?? asc, ${orderByString}`;
				orderByFields.unshift(knex.ref("directus_row_number"));
			}
			dbQuery.orderByRaw(orderByString, orderByFields);
		} else {
			sortRecords.map((sortRecord) => {
				if (sortRecord.column.includes(".")) {
					const [alias, field] = sortRecord.column.split(".");
					sortRecord.column = getColumn(knex, alias, field, false, schema, {
						originalCollectionName: getCollectionFromAlias(alias, aliasMap),
						generateAlias
					});
				} else sortRecord.column = getColumn(knex, table, sortRecord.column, false, schema, { generateAlias });
			});
			dbQuery.orderBy(sortRecords);
		}
	}
	if (!needsInnerQuery) return dbQuery;
	const innerCaseWhenAliasPrefix = generateAlias();
	if (hasCaseWhen) {
		const innerPreprocess = getInnerQueryColumnPreProcessor(knex, schema, table, cases, permissions, aliasMap, innerCaseWhenAliasPrefix, generateAlias);
		dbQuery.select(fieldNodes.map(innerPreprocess).filter((x) => x !== null));
		dbQuery.select(o2mNodes.map(innerPreprocess).filter((x) => x !== null));
		const groupByFields = [knex.raw("??.??", [table, primaryKey])];
		helpers.schema.addInnerSortFieldsToGroupBy(groupByFields, innerQuerySortRecords, (hasMultiRelationalSort || sortRecords?.some(({ column }) => column.includes("."))) ?? false);
		dbQuery.groupBy(groupByFields);
	}
	const wrapperQuery = knex.from(table).innerJoin(knex.raw("??", dbQuery.as("inner")), `${table}.${primaryKey}`, `inner.${primaryKey}`);
	if (!hasCaseWhen) wrapperQuery.select(fieldNodes.map((node) => preProcess(node)));
	else {
		const plainColumns = fieldNodes.filter((fieldNode) => !fieldNode.whenCase || fieldNode.whenCase.length === 0);
		const whenCaseColumns = fieldNodes.filter((fieldNode) => fieldNode.whenCase && fieldNode.whenCase.length > 0);
		wrapperQuery.select(plainColumns.map((node) => preProcess(node)));
		wrapperQuery.select(whenCaseColumns.map((fieldNode) => {
			const alias = getNodeAlias(fieldNode);
			const innerAlias = `${innerCaseWhenAliasPrefix}_${alias}`;
			const column = preProcess({
				...fieldNode,
				whenCase: []
			}, { noAlias: true });
			return knex.raw(`CASE WHEN ??.?? > 0 THEN ?? END as ??`, [
				"inner",
				innerAlias,
				column,
				alias
			]);
		}));
		wrapperQuery.select(o2mNodes.filter((node) => node.whenCase && node.whenCase.length > 0).map((node) => {
			const alias = node.fieldKey;
			const innerAlias = `${innerCaseWhenAliasPrefix}_${alias}`;
			return knex.raw(`CASE WHEN ??.?? > 0 THEN 1 END as ??`, [
				"inner",
				innerAlias,
				alias
			]);
		}));
	}
	if (sortRecords) {
		innerQuerySortRecords.map((innerQuerySortRecord) => {
			wrapperQuery.orderBy(`inner.${innerQuerySortRecord.alias}`, innerQuerySortRecord.order);
		});
		if (hasMultiRelationalSort) {
			wrapperQuery.where("inner.directus_row_number", "=", 1);
			applyLimit(knex, wrapperQuery, queryCopy.limit);
		}
	}
	return wrapperQuery;
}

//#endregion
export { getDBQuery };