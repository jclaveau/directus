//#region src/utils/parse-filter-key.ts
/**
* Result for keys with a function (e.g. `year(date_created)`):
* - Group 1: Function (`year`)
* - Group 3: Field (`date_created`)
*
* If group 3 is undefined, it is a key without a function.
*/
const FILTER_KEY_REGEX = /^([^()]+)(\(([^)]+)\))?/;
/**
* Parses a filter key, returning its field name and function name (if defined) separately.
*/
function parseFilterKey(key) {
	const match = key.match(FILTER_KEY_REGEX);
	const fieldNameWithFunction = match?.[3]?.trim();
	return {
		fieldName: fieldNameWithFunction || key.trim(),
		functionName: fieldNameWithFunction ? match?.[1]?.trim() : void 0
	};
}

//#endregion
export { parseFilterKey };