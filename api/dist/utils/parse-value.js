import { parseJSON } from "@directus/utils";

//#region src/utils/parse-value.ts
/**
* Parse a value that might be a JSON string, returning a typed result or fallback.
*/
function parseValue(value, fallback) {
	if (!value) return fallback;
	if (typeof value === "string") return parseJSON(value);
	return value;
}

//#endregion
export { parseValue };