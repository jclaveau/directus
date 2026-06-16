import { parseJsonFunction } from "../../helpers/fn/json/parse-function.js";
import { applyFunctionToColumnName } from "./apply-function-to-column-name.js";
import { getFunctions } from "../../helpers/index.js";
import { InvalidQueryError } from "@directus/errors";
import { getFunctionsForType } from "@directus/utils";
import { REGEX_BETWEEN_PARENS } from "@directus/constants";

//#region src/database/run-ast/utils/get-column.ts
/**
* Return column prefixed by table. If column includes functions (like `year(date_created)`), the
* column is replaced with the appropriate SQL
*
* @param knex Current knex / transaction instance
* @param table Collection or alias in which column resides
* @param column name of the column
* @param alias Whether or not to add a SQL AS statement
* @param schema For retrieval of the column type
* @param options Optional parameters
* @returns Knex raw instance
*/
function getColumn(knex, table, column, alias = applyFunctionToColumnName(column), schema, options) {
	const fn = getFunctions(knex, schema);
	if (column.includes("(") && column.includes(")")) {
		const functionName = column.split("(")[0];
		const columnName = column.match(REGEX_BETWEEN_PARENS)[1];
		if (functionName in fn) {
			const collectionName = options?.originalCollectionName || table;
			let fieldName = columnName;
			let jsonPath;
			if (functionName === "json") {
				const result$1 = parseJsonFunction(column);
				fieldName = result$1.field;
				jsonPath = result$1.path;
			}
			const type = schema?.collections[collectionName]?.fields?.[fieldName]?.type ?? "unknown";
			if (getFunctionsForType(type).includes(functionName) === false) throw new InvalidQueryError({ reason: `Invalid function specified "${functionName}"` });
			const result = fn[functionName](table, fieldName, {
				type,
				relationalCountOptions: isFunctionColumnOptions(options) ? {
					query: options.query,
					cases: options.cases,
					permissions: options.permissions
				} : void 0,
				originalCollectionName: options?.originalCollectionName,
				jsonPath,
				...options?.jsonReturnType && { jsonReturnType: options.jsonReturnType }
			});
			if (alias) return knex.raw(result + " AS ??", [alias]);
			return result;
		} else throw new InvalidQueryError({ reason: `Invalid function specified "${functionName}"` });
	}
	if (alias && column !== alias) return knex.ref(`${table}.${column}`).as(alias);
	return knex.ref(`${table}.${column}`);
}
function isFunctionColumnOptions(options) {
	return !!options && "query" in options;
}

//#endregion
export { getColumn };