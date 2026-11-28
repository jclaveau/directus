import { flattenFilter } from "../../../../permissions/modules/process-ast/utils/flatten-filter.js";
import { isObject } from "@directus/utils/values";

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
	if (childKey) {
		const childOperation = getOperation(childKey, Object.values(value)[0]);
		if (!childOperation && (key === "_none" || key === "_some")) {
			const fieldPaths = [];
			flattenFilter(fieldPaths, value);
			if (fieldPaths.length > 0) return {
				operator: key,
				value
			};
		}
		return childOperation;
	}
	return null;
}

//#endregion
export { getOperation };