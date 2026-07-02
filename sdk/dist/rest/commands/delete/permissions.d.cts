import { DirectusPermission } from "../../../schema/permission.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/delete/permissions.d.ts

/**
 * Delete multiple existing permissions rules
 * @param keys
 * @returns
 * @throws Will throw if keys is empty
 */
declare const deletePermissions: <Schema>(keys: DirectusPermission<Schema>["id"][]) => RestCommand<void, Schema>;
/**
 * Delete an existing permissions rule
 * @param key
 * @returns
 * @throws Will throw if key is empty
 */
declare const deletePermission: <Schema>(key: DirectusPermission<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deletePermission, deletePermissions };
//# sourceMappingURL=permissions.d.cts.map