import { sanitizeQuery } from "../../utils/sanitize-query.js";
import { parseJSON } from "@directus/utils";

//#region src/ai/tools/utils.ts
const JSON_COERCE_FIELDS = [
	"data",
	"keys",
	"query",
	"headers"
];
/**
* LLMs sometimes return object/array arguments as stringified JSON.
* Coerce known fields back to native values before validation.
*/
function coerceJsonFields(args) {
	const coerced = { ...args };
	for (const field of JSON_COERCE_FIELDS) if (typeof coerced[field] === "string") try {
		coerced[field] = parseJSON(coerced[field]);
	} catch {}
	return coerced;
}
/**
* Build a sanitized query object from a tool's args payload.
* - Ensures fields defaults to '*' when not provided
* - Returns an empty object when no args.query is present
*/
async function buildSanitizedQueryFromArgs(args, schema, accountability) {
	let sanitizedQuery = {};
	if (args?.query) {
		const q = args.query;
		sanitizedQuery = await sanitizeQuery({
			fields: q["fields"] ?? "*",
			...q
		}, schema, accountability ?? void 0);
	}
	return sanitizedQuery;
}

//#endregion
export { buildSanitizedQueryFromArgs, coerceJsonFields };