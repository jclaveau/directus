import { NestedPartial } from "../../../types/utils.cjs";
import { CollectionType, SingletonCollections } from "../../../types/schema.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

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
//# sourceMappingURL=singleton.d.cts.map