import { toPath } from "lodash-es";

//#region src/database/helpers/fn/json/mysql-json-path.ts
/**
* Build a MySQL/MariaDB JSON path string using dot notation.
*
* @example ".color" → "$.color"
* @example ".items[0].name" → "$.items[0].name"
*/
function convertToMySQLPath(path) {
	const parts = toPath(path.startsWith(".") ? path.slice(1) : path);
	let result = "$";
	for (const part of parts) {
		const num = Number(part);
		if (Number.isInteger(num) && num >= 0 && String(num) === part) result += `[${part}]`;
		else result += `.${part}`;
	}
	return result;
}

//#endregion
export { convertToMySQLPath };