import { CollectionType, RegularCollections } from "../../../types/schema.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query, QueryItem } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/read/items.d.ts
type ReadItemOutput<Schema, Collection extends RegularCollections<Schema>, TQuery extends Query<Schema, CollectionType<Schema, Collection>>> = ApplyQueryFields<Schema, CollectionType<Schema, Collection>, TQuery['fields']>;
/**
 * List all items that exist in Directus.
 *
 * @param collection The collection of the items
 * @param query The query parameters
 *
 * @returns An array of up to limit item objects. If no items are available, data will be an empty array.
 * @throws Will throw if collection is a core collection
 * @throws Will throw if collection is empty
 */
declare const readItems: <Schema, Collection extends RegularCollections<Schema>, const TQuery extends Query<Schema, CollectionType<Schema, Collection>>>(collection: Collection, query?: TQuery) => RestCommand<ReadItemOutput<Schema, Collection, TQuery>[], Schema>;
/**
 * Get an item that exists in Directus.
 *
 * @param collection The collection of the item
 * @param key The primary key of the item
 * @param query The query parameters
 *
 * @returns Returns an item object if a valid primary key was provided.
 * @throws Will throw if collection is a core collection
 * @throws Will throw if collection is empty
 * @throws Will throw if key is empty
 */
declare const readItem: <Schema, Collection extends RegularCollections<Schema>, const TQuery extends QueryItem<Schema, CollectionType<Schema, Collection>>>(collection: Collection, key: string | number, query?: TQuery) => RestCommand<ReadItemOutput<Schema, Collection, TQuery>, Schema>;
//#endregion
export { ReadItemOutput, readItem, readItems };
//# sourceMappingURL=items.d.cts.map