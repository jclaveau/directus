import { isObject } from "@directus/utils";

//#region src/database/run-ast/lib/apply-query/get-operation.ts
/**
* Returns null or the operation information form a FieldFilter
*/
function getOperation(key, value) {
	if (key === "_and" || key === "_or") return null;
	if (key.startsWith("_") && key !== "_none" && key !== "_some") return {
		operator: key,
		value
	};
	else if (!isObject(value)) return {
		operator: "_eq",
		value
	};
	const childKey = Object.keys(value)[0];
	if (childKey) return getOperation(childKey, Object.values(value)[0]);
	return null;
}

//#endregion
export { getOperation };