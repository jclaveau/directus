import { mapKeys, omitBy } from "lodash-es";

//#region src/database/get-ast-from-query/utils/get-deep-query.ts
/**
* Convert Deep query object to regular query object by ignoring all nested fields and returning the
* `_` prefixed fields as top level query fields
*
* @example
*
* ```js
* getDeepQuery({
*   _sort: ['a']
* });
* // => { sort: ['a'] }
* ```
*/
function getDeepQuery(query) {
	return mapKeys(omitBy(query, (_value, key) => key.startsWith("_") === false), (_value, key) => key.substring(1));
}

//#endregion
export { getDeepQuery };