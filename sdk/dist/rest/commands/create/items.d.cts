import { NestedPartial, UnpackList } from "../../../types/utils.cjs";
import { CollectionType } from "../../../types/schema.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/create/items.d.ts
type CreateItemOutput<Schema, Collection extends keyof Schema, TQuery extends Query<Schema, Schema[Collection]>> = ApplyQueryFields<Schema, CollectionType<Schema, Collection>, TQuery["fields"]>;
/**
* Create new items in the given collection.
*
* @param collection The collection of the item
* @param items The items to create
* @param query Optional return data query
*
* @returns Returns the item objects of the item that were created.
*/
declare const createItems: <Schema, Collection extends keyof Schema, const TQuery extends Query<Schema, Schema[Collection]>>(collection: Collection, items: NestedPartial<UnpackList<Schema[Collection]>>[], query?: TQuery) => RestCommand<CreateItemOutput<Schema, Collection, TQuery>[], Schema>;
/**
* Create a new item in the given collection.
*
* @param collection The collection of the item
* @param item The item to create
* @param query Optional return data query
*
* @returns Returns the item objects of the item that were created.
*/
declare const createItem: <Schema, Collection extends keyof Schema, const TQuery extends Query<Schema, Schema[Collection]>>(collection: Collection, item: NestedPartial<UnpackList<Schema[Collection]>>, query?: TQuery) => RestCommand<CreateItemOutput<Schema, Collection, TQuery>, Schema>;
//#endregion
export { CreateItemOutput, createItem, createItems };
//# sourceMappingURL=items.d.cts.map