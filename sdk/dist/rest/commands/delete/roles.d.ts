import { DirectusRole } from "../../../schema/role.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/delete/roles.d.ts

/**
 * Delete multiple existing roles.
 * @param keys
 * @returns
 * @throws Will throw if keys is empty
 */
declare const deleteRoles: <Schema>(keys: DirectusRole<Schema>["id"][]) => RestCommand<void, Schema>;
/**
 * Delete an existing role.
 * @param key
 * @returns
 * @throws Will throw if key is empty
 */
declare const deleteRole: <Schema>(key: DirectusRole<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deleteRole, deleteRoles };
//# sourceMappingURL=roles.d.ts.map