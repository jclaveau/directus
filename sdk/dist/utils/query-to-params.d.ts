import { ExtendedQuery } from "../types/query.js";

//#region src/utils/query-to-params.d.ts

/**
* Transform nested query object to an url compatible format
*
* @param query The nested query object
*
* @returns Flat query parameters
*/
declare const queryToParams: <Schema = any, Item = Record<string, unknown>>(query: ExtendedQuery<Schema, Item>) => Record<string, string>;
//#endregion
export { queryToParams };
//# sourceMappingURL=query-to-params.d.ts.map