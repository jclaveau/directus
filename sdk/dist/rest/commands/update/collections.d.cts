import { DirectusCollection } from "../../../schema/collection.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/update/collections.d.ts
type UpdateCollectionOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusCollection<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * Update the metadata for an existing collection.
 * @param collection
 * @param item
 * @param query
 * @returns The collection object for the updated collection in this request.
 * @throws Will throw if collection is empty
 */
declare const updateCollection: <Schema, const TQuery extends Query<Schema, DirectusCollection<Schema>>>(collection: DirectusCollection<Schema>["collection"], item: NestedPartial<DirectusCollection<Schema>>, query?: TQuery) => RestCommand<UpdateCollectionOutput<Schema, TQuery>, Schema>;
/**
 * Update multiple collections as batch.
 * @param items
 * @param query
 * @returns Returns the collection objects for the updated collections.
 */
declare const updateCollectionsBatch: <Schema, const TQuery extends Query<Schema, DirectusCollection<Schema>>>(items: NestedPartial<DirectusCollection<Schema>>[], query?: TQuery) => RestCommand<UpdateCollectionOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdateCollectionOutput, updateCollection, updateCollectionsBatch };
//# sourceMappingURL=collections.d.cts.map