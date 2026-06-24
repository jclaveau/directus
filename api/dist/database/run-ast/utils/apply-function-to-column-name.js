import { REGEX_BETWEEN_PARENS } from "@directus/constants";

//#region src/database/run-ast/utils/apply-function-to-column-name.ts
/**
* Takes in a column name, and transforms the original name with the generated column name based on
* the applied function.
*
* @example
*
* ```js
* applyFunctionToColumnName('year(date_created)');
* // => "date_created_year"
* ```
*/
function applyFunctionToColumnName(column) {
	if (column.includes("(") && column.includes(")")) {
		const functionName = column.split("(")[0];
		const columnName = column.match(REGEX_BETWEEN_PARENS)[1];
		if (functionName === "json") {
			const slug = columnName?.replace(/[.[\],\s]+/g, "_");
			return `${slug}${slug?.endsWith("_") ? "" : "_"}${functionName}`;
		} else return `${columnName}_${functionName}`;
	} else return column;
}

//#endregion
export { applyFunctionToColumnName };