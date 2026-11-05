import { DirectusUser } from "../../../schema/user.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/delete/users.d.ts

/**
 * Delete multiple existing users.
 *
 * @param keys
 * @returns Nothing
 * @throws Will throw if keys is empty
 */
declare const deleteUsers: <Schema>(keys: DirectusUser<Schema>["id"][]) => RestCommand<void, Schema>;
/**
 * Delete an existing user.
 *
 * @param key
 * @returns Nothing
 * @throws Will throw if key is empty
 */
declare const deleteUser: <Schema>(key: DirectusUser<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deleteUser, deleteUsers };
//# sourceMappingURL=users.d.cts.map