import { DirectusShare } from "../../../schema/share.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/delete/shares.d.ts

/**
 * Delete multiple existing shares.
 * @param keys
 * @returns
 * @throws Will throw if keys is empty
 */
declare const deleteShares: <Schema>(keys: DirectusShare<Schema>["id"][]) => RestCommand<void, Schema>;
/**
 * Delete an existing share.
 * @param key
 * @returns
 * @throws Will throw if key is empty
 */
declare const deleteShare: <Schema>(key: DirectusShare<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deleteShare, deleteShares };
//# sourceMappingURL=shares.d.ts.map