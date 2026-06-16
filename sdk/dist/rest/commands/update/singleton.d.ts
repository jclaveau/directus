import { NestedPartial } from "../../../types/utils.js";
import { CollectionType, SingletonCollections } from "../../../types/schema.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/update/singleton.d.ts
type UpdateSingletonOutput<Schema, Collection extends SingletonCollections<Schema>, TQuery extends Query<Schema, Schema[Collection]>> = ApplyQueryFields<Schema, CollectionType<Schema, Collection>, TQuery["fields"]>;
/**
* Update a singleton item
*
* @param collection The collection of the items
* @param query The query parameters
*
* @returns An array of up to limit item objects. If no items are available, data will be an empty array.
* @throws Will throw if collection is a core collection
* @throws Will throw if collection is empty
*/
declare const updateSingleton: <Schema, Collection extends SingletonCollections<Schema>, const TQuery extends Query<Schema, Schema[Collection]>, Item = Schema[Collection]>(collection: Collection, item: NestedPartial<Item>, query?: TQuery) => RestCommand<UpdateSingletonOutput<Schema, Collection, TQuery>, Schema>;
//#endregion
export { UpdateSingletonOutput, updateSingleton };
//# sourceMappingURL=singleton.d.ts.map