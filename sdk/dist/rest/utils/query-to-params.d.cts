import { Query } from "../../types/query.cjs";
import { AggregationTypes, GroupByFields } from "../../types/aggregate.cjs";

//#region src/rest/utils/query-to-params.d.ts
type ExtendedQuery<Schema, Item> = Query<Schema, Item> & {
  aggregate?: Record<keyof AggregationTypes, string>;
  groupBy?: (string | GroupByFields<Schema, Item>)[];
};
declare const formatFields: (fields: (string | Record<string, any>)[]) => string[];
/**
 * Transform nested query object to an url compatible format
 *
 * @param query The nested query object
 *
 * @returns Flat query parameters
 */
declare const queryToParams: <Schema, Item>(query: ExtendedQuery<Schema, Item>) => Record<string, string>;
//#endregion
export { formatFields, queryToParams };
//# sourceMappingURL=query-to-params.d.cts.map