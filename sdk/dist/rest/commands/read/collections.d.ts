import { DirectusCollection } from "../../../schema/collection.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/read/collections.d.ts
type ReadCollectionOutput<Schema, Item extends object = DirectusCollection<Schema>> = ApplyQueryFields<Schema, Item, '*'>;
/**
 * List the available collections.
 * @returns An array of collection objects.
 */
declare const readCollections: <Schema>() => RestCommand<ReadCollectionOutput<Schema>[], Schema>;
/**
 * Retrieve a single collection by table name.
 * @param collection The collection name
 * @returns A collection object.
 * @throws Will throw if collection is empty
 */
declare const readCollection: <Schema>(collection: DirectusCollection<Schema>["collection"]) => RestCommand<ReadCollectionOutput<Schema>, Schema>;
//#endregion
export { ReadCollectionOutput, readCollection, readCollections };
//# sourceMappingURL=collections.d.ts.map