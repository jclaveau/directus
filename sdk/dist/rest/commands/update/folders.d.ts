import { DirectusFolder } from "../../../schema/folder.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/update/folders.d.ts
type UpdateFolderOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusFolder<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update multiple existing folders.
* @param keys
* @param item
* @param query
* @returns Returns the folder objects of the folders that were updated.
* @throws Will throw if keys is empty
*/
declare const updateFolders: <Schema, const TQuery extends Query<Schema, DirectusFolder<Schema>>>(keys: DirectusFolder<Schema>["id"][], item: NestedPartial<DirectusFolder<Schema>>, query?: TQuery) => RestCommand<UpdateFolderOutput<Schema, TQuery>[], Schema>;
/**
* Update multiple folders as batch.
* @param items
* @param query
* @returns Returns the folder objects of the folders that were updated.
*/
declare const updateFoldersBatch: <Schema, const TQuery extends Query<Schema, DirectusFolder<Schema>>>(items: NestedPartial<DirectusFolder<Schema>>[], query?: TQuery) => RestCommand<UpdateFolderOutput<Schema, TQuery>[], Schema>;
/**
* Update an existing folder.
* @param key
* @param item
* @param query
* @returns Returns the folder object of the folder that was updated.
* @throws Will throw if key is empty
*/
declare const updateFolder: <Schema, const TQuery extends Query<Schema, DirectusFolder<Schema>>>(key: DirectusFolder<Schema>["id"], item: NestedPartial<DirectusFolder<Schema>>, query?: TQuery) => RestCommand<UpdateFolderOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdateFolderOutput, updateFolder, updateFolders, updateFoldersBatch };
//# sourceMappingURL=folders.d.ts.map