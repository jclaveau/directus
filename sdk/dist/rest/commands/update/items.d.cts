import { NestedPartial, UnpackList } from "../../../types/utils.cjs";
import { CollectionType } from "../../../types/schema.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/update/items.d.ts
type UpdateItemOutput<Schema, Collection extends keyof Schema, TQuery extends Query<Schema, Schema[Collection]>> = ApplyQueryFields<Schema, CollectionType<Schema, Collection>, TQuery["fields"]>;
/**
* Update multiple items at the same time.
*
* @param collection The collection of the items
* @param keysOrQuery The primary keys or a query
* @param item The item data to update
* @param query Optional return data query
*
* @returns Returns the item objects for the updated items.
* @throws Will throw if keysOrQuery is empty
* @throws Will throw if collection is empty
* @throws Will throw if collection is a core collection
*/
declare const updateItems: <Schema, Collection extends keyof Schema, const TQuery extends Query<Schema, Schema[Collection]>>(collection: Collection, keysOrQuery: string[] | number[] | Query<Schema, Schema[Collection]>, item: NestedPartial<UnpackList<Schema[Collection]>>, query?: TQuery) => RestCommand<UpdateItemOutput<Schema, Collection, TQuery>[], Schema>;
/**
* Update multiple items as batch.
*
* @param collection The collection of the items
* @param items The items to update
* @param query Optional return data query
*
* @returns Returns the item objects for the updated items.
* @throws Will throw if collection is empty
* @throws Will throw if collection is a core collection
*/
declare const updateItemsBatch: <Schema, Collection extends keyof Schema, const TQuery extends Query<Schema, Schema[Collection]>>(collection: Collection, items: NestedPartial<UnpackList<Schema[Collection]>>[], query?: TQuery) => RestCommand<UpdateItemOutput<Schema, Collection, TQuery>[], Schema>;
/**
* Update an existing item.
*
* @param collection The collection of the item
* @param key The primary key of the item
* @param item The item data to update
* @param query Optional return data query
*
* @returns Returns the item object of the item that was updated.
* @throws Will throw if key is empty
* @throws Will throw if collection is empty
* @throws Will throw if collection is a core collection
*/
declare const updateItem: <Schema, Collection extends keyof Schema, const TQuery extends Query<Schema, Schema[Collection]>, Item = UnpackList<Schema[Collection]>>(collection: Collection, key: string | number, item: NestedPartial<Item>, query?: TQuery) => RestCommand<UpdateItemOutput<Schema, Collection, TQuery>, Schema>;
//#endregion
export { UpdateItemOutput, updateItem, updateItems, updateItemsBatch };
//# sourceMappingURL=items.d.cts.map