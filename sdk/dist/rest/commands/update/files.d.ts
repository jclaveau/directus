import { DirectusFile } from "../../../schema/file.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/update/files.d.ts
type UpdateFileOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusFile<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update multiple files at the same time.
* @param keys
* @param item
* @param query
* @returns Returns the file objects for the updated files.
* @throws Will throw if keys is empty
*/
declare const updateFiles: <Schema, const TQuery extends Query<Schema, DirectusFile<Schema>>>(keys: DirectusFile<Schema>["id"][], item: NestedPartial<DirectusFile<Schema>>, query?: TQuery) => RestCommand<UpdateFileOutput<Schema, TQuery>[], Schema>;
/**
* Update multiple files as batch.
* @param items
* @param query
* @returns Returns the file objects for the updated files.
*/
declare const updateFilesBatch: <Schema, const TQuery extends Query<Schema, DirectusFile<Schema>>>(items: NestedPartial<DirectusFile<Schema>>[], query?: TQuery) => RestCommand<UpdateFileOutput<Schema, TQuery>[], Schema>;
/**
* Update an existing file, and/or replace it's file contents.
* @param key
* @param item
* @param query
* @returns Returns the file object for the updated file.
* @throws Will throw if key is empty
*/
declare const updateFile: <Schema, const TQuery extends Query<Schema, DirectusFile<Schema>>>(key: DirectusFile<Schema>["id"], item: NestedPartial<DirectusFile<Schema>> | FormData, query?: TQuery) => RestCommand<UpdateFileOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdateFileOutput, updateFile, updateFiles, updateFilesBatch };
//# sourceMappingURL=files.d.ts.map