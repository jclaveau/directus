import { CollectionType, SingletonCollections } from "../../../types/schema.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query, QueryItem } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/read/singleton.d.ts
type ReadSingletonOutput<Schema, Collection extends SingletonCollections<Schema>, TQuery extends Query<Schema, Schema[Collection]>> = ApplyQueryFields<Schema, CollectionType<Schema, Collection>, TQuery['fields']>;
/**
 * List the singleton item in Directus.
 *
 * @param collection The collection of the items
 * @param query The query parameters
 *
 * @returns An array of up to limit item objects. If no items are available, data will be an empty array.
 * @throws Will throw if collection is a core collection
 * @throws Will throw if collection is empty
 */
declare const readSingleton: <Schema, Collection extends SingletonCollections<Schema>, const TQuery extends QueryItem<Schema, Schema[Collection]>>(collection: Collection, query?: TQuery) => RestCommand<ReadSingletonOutput<Schema, Collection, TQuery>, Schema>;
//#endregion
export { ReadSingletonOutput, readSingleton };
//# sourceMappingURL=singleton.d.ts.map