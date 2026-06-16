import { parseFilterKey } from "../../../../../utils/parse-filter-key.js";
import { InvalidQueryError } from "@directus/errors";
import { getFunctionsForType, getOutputTypeForFunction } from "@directus/utils";

//#region src/database/run-ast/lib/apply-query/filter/get-filter-type.ts
function getFilterType(fields, key, collection = "unknown") {
	const { fieldName, functionName } = parseFilterKey(key);
	const field = fields[fieldName];
	if (!field) throw new InvalidQueryError({ reason: `Invalid filter key "${key}" on "${collection}"` });
	const { type } = field;
	if (functionName) {
		if (!getFunctionsForType(type).includes(functionName)) throw new InvalidQueryError({ reason: `Invalid filter key "${key}" on "${collection}"` });
		return { type: getOutputTypeForFunction(functionName) };
	}
	return {
		type,
		special: field.special
	};
}

//#endregion
export { getFilterType };