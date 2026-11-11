import { DirectusFile } from "../../../schema/file.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/delete/files.d.ts

/**
 * Delete multiple files at once.
 * @param keys
 * @returns
 * @throws Will throw if keys is empty
 */
declare const deleteFiles: <Schema>(keys: DirectusFile<Schema>["id"][]) => RestCommand<void, Schema>;
/**
 * Delete an existing file.
 * @param key
 * @returns
 * @throws Will throw if key is empty
 */
declare const deleteFile: <Schema>(key: DirectusFile<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deleteFile, deleteFiles };
//# sourceMappingURL=files.d.ts.map