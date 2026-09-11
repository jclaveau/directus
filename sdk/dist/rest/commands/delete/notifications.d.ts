import { DirectusNotification } from "../../../schema/notification.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/delete/notifications.d.ts

/**
 * Delete multiple existing notifications.
 * @param keys
 * @returns
 * @throws Will throw if keys is empty
 */
declare const deleteNotifications: <Schema>(keys: DirectusNotification<Schema>["id"][]) => RestCommand<void, Schema>;
/**
 * Delete an existing notification.
 * @param key
 * @returns
 * @throws Will throw if key is empty
 */
declare const deleteNotification: <Schema>(key: DirectusNotification<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deleteNotification, deleteNotifications };
//# sourceMappingURL=notifications.d.ts.map