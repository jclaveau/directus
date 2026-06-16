import { toPath } from "lodash-es";

//#region src/database/helpers/fn/json/postgres-json-path.ts
/**
* Build a parameterized PostgreSQL JSON path using -> operators.
* Returns a template string containing only operators and ? placeholders,
* plus a bindings array with the actual values.
*
* When asText is true, the final step uses ->> to return text instead of json,
* which is required for WHERE clause comparisons (LIKE, =, etc.) and ORDER BY.
*
* @example ".color" → { template: "->?", bindings: ["color"] }
* @example ".color" (asText) → { template: "->>?", bindings: ["color"] }
* @example ".items[0].name" → { template: "->?->?->?", bindings: ["items", 0, "name"] }
* @example ".items[0].name" (asText) → { template: "->?->?->>?", bindings: ["items", 0, "name"] }
*/
function buildPostgresJsonPath(path, options) {
	const parts = toPath(path.startsWith(".") ? path.slice(1) : path);
	let template = "";
	const bindings = [];
	for (let i = 0; i < parts.length - 1; i++) {
		const part$1 = parts[i];
		if (isArrayIndex(part$1)) template += `->${part$1}`;
		else {
			template += "->?";
			bindings.push(part$1);
		}
	}
	const part = parts[parts.length - 1];
	const operator = options?.asText ? "->>" : "->";
	if (isArrayIndex(part)) template += operator + part;
	else {
		template += operator + "?";
		bindings.push(part);
	}
	return {
		template,
		bindings
	};
}
/**
* Checks if a provided value is a valid positive number for array access
*/
function isArrayIndex(value) {
	if (typeof value === "number") return value >= 0 && Number.isInteger(value);
	if (typeof value === "string") {
		const num = Number(value);
		return String(num) === value && num >= 0 && Number.isInteger(num);
	}
	return false;
}

//#endregion
export { buildPostgresJsonPath };