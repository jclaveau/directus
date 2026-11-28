import { DirectusCollection } from "../../../schema/collection.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/delete/collections.d.ts

/**
 * Delete a collection.
 * @param collection
 * @returns
 */
declare const deleteCollection: <Schema>(collection: DirectusCollection<Schema>["collection"]) => RestCommand<void, Schema>;
//#endregion
export { deleteCollection };
//# sourceMappingURL=collections.d.ts.map