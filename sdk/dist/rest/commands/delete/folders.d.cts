import { DirectusFolder } from "../../../schema/folder.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/delete/folders.d.ts

/**
 * Delete multiple existing folders.
 * @param keys
 * @returns
 * @throws Will throw if keys is empty
 */
declare const deleteFolders: <Schema>(keys: DirectusFolder<Schema>["id"][]) => RestCommand<void, Schema>;
/**
 * Delete an existing folder.
 * @param key
 * @returns
 * @throws Will throw if key is empty
 */
declare const deleteFolder: <Schema>(key: DirectusFolder<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deleteFolder, deleteFolders };
//# sourceMappingURL=folders.d.cts.map