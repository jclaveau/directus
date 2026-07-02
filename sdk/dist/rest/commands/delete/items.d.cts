import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/delete/items.d.ts

/**
 * Delete multiple existing items.
 *
 * @param collection The collection of the items
 * @param keysOrQuery The primary keys or a query
 *
 * @returns Nothing
 * @throws Will throw if collection is empty
 * @throws Will throw if collection is a core collection
 * @throws Will throw if keysOrQuery is empty
 */
declare const deleteItems: <Schema, Collection extends keyof Schema, const TQuery extends Query<Schema, Schema[Collection]>>(collection: Collection, keysOrQuery: string[] | number[] | TQuery) => RestCommand<void, Schema>;
/**
 * Delete an existing item.
 *
 * @param collection The collection of the item
 * @param key The primary key of the item
 *
 * @returns Nothing
 * @throws Will throw if collection is empty
 * @throws Will throw if collection is a core collection
 * @throws Will throw if key is empty
 */
declare const deleteItem: <Schema, Collection extends keyof Schema>(collection: Collection, key: string | number) => RestCommand<void, Schema>;
//#endregion
export { deleteItem, deleteItems };
//# sourceMappingURL=items.d.cts.map