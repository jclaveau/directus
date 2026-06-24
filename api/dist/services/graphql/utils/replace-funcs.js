import { transform } from "lodash-es";
import { FUNCTIONS } from "@directus/constants";

//#region src/services/graphql/utils/replace-funcs.ts
/**
* Replace functions from GraphQL format to Directus-Filter format
*/
function replaceFuncs(filter) {
	return replaceFuncDeep(filter);
	function replaceFuncDeep(filter$1) {
		return transform(filter$1, (result, value, key) => {
			if (typeof key === "string" && key.endsWith("_func") && FUNCTIONS.includes(Object.keys(value)[0])) {
				const functionName = Object.keys(value)[0];
				const fieldName = key.slice(0, -5);
				result[`${functionName}(${fieldName})`] = Object.values(value)[0];
			} else result[key] = value?.constructor === Object || value?.constructor === Array ? replaceFuncDeep(value) : value;
		});
	}
}

//#endregion
export { replaceFuncs };