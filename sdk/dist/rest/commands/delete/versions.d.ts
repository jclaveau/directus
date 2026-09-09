import { DirectusVersion } from "../../../schema/version.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/delete/versions.d.ts

/**
 * Delete multiple existing Content Versions.
 * @param keys
 * @returns
 * @throws Will throw if keys is empty
 */
declare const deleteContentVersions: <Schema>(keys: DirectusVersion<Schema>["id"][]) => RestCommand<void, Schema>;
/**
 * Delete an existing Content Version.
 * @param key
 * @returns
 * @throws Will throw if key is empty
 */
declare const deleteContentVersion: <Schema>(key: DirectusVersion<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deleteContentVersion, deleteContentVersions };
//# sourceMappingURL=versions.d.ts.map