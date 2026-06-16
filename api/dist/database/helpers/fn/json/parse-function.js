import { useEnv } from "@directus/env";
import { InvalidQueryError } from "@directus/errors";

//#region src/database/helpers/fn/json/parse-function.ts
const env = useEnv();
const MAX_JSON_QUERY_DEPTH = Number(env["MAX_JSON_QUERY_DEPTH"]);
/**
* Calculates the depth of a JSON path by counting the number of property accesses and array accesses.
* @example .color → 1
* @example .settings.theme → 2
* @example .items[0].name → 3
* @example [0] → 1
*/
function calculateJsonPathDepth(path) {
	let depth = 0;
	for (let i = 0; i < path.length; i++) if (path[i] === "." || path[i] === "[") depth++;
	return depth;
}
/**
* Validates and normalizes a bare JSON path string (e.g. "color" or "settings.theme").
* Adds a leading dot if absent. Throws on unsupported expressions or depth overflow.
*/
function parseJsonPath(path) {
	const normalized = path.startsWith("[") ? path : `.${path}`;
	if (/\[\]|\.\.|[*?@$]|\[-/.test(normalized)) throw new InvalidQueryError({ reason: "Invalid JSON path: unsupported path expression" });
	if (!/^[\p{L}\p{N}\p{Extended_Pictographic}\w.[\]]+$/u.test(normalized)) throw new InvalidQueryError({ reason: "Invalid JSON path: unsupported path expression" });
	const depth = calculateJsonPathDepth(normalized);
	if (depth > MAX_JSON_QUERY_DEPTH) throw new InvalidQueryError({ reason: `JSON path depth (${depth}) exceeds allowed maximum of ${MAX_JSON_QUERY_DEPTH}` });
	return normalized;
}
/**
* Parses a json function selection into its field and path components.
* Expects relational prefixes to have already been extracted by parseFilterFunctionPath,
* so the field should always be a simple column name.
* @example json(metadata, color) → { field: 'metadata', path: '.color' }
* @example json(data, items[0].name) → { field: 'data', path: '.items[0].name' }
*/
function parseJsonFunction(functionString) {
	if (!functionString.startsWith("json(") || !functionString.endsWith(")")) throw new InvalidQueryError({ reason: "Invalid json() syntax" });
	const content = functionString.substring(5, functionString.length - 1).trim();
	if (!content) throw new InvalidQueryError({ reason: "Invalid json() syntax" });
	const commaIndex = content.indexOf(",");
	if (commaIndex === -1) throw new InvalidQueryError({ reason: "Invalid json() syntax: requires json(field, path) format" });
	if (commaIndex === 0) throw new InvalidQueryError({ reason: "Invalid json() syntax: missing field name" });
	const field = content.substring(0, commaIndex).trim();
	const pathContent = content.substring(commaIndex + 1).trim();
	if (!pathContent) throw new InvalidQueryError({ reason: "Invalid json() syntax: missing path" });
	return {
		field,
		path: parseJsonPath(pathContent)
	};
}

//#endregion
export { calculateJsonPathDepth, parseJsonFunction, parseJsonPath };