import { DirectusNotification } from "../../../schema/notification.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/update/notifications.d.ts
type UpdateNotificationOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusNotification<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update multiple existing notifications.
* @param keys
* @param item
* @param query
* @returns Returns the notification objects for the updated notifications.
* @throws Will throw if keys is empty
*/
declare const updateNotifications: <Schema, const TQuery extends Query<Schema, DirectusNotification<Schema>>>(keys: DirectusNotification<Schema>["id"][], item: NestedPartial<DirectusNotification<Schema>>, query?: TQuery) => RestCommand<UpdateNotificationOutput<Schema, TQuery>[], Schema>;
/**
* Update multiple notifications as batch.
* @param items
* @param query
* @returns Returns the notification objects for the updated notifications.
*/
declare const updateNotificationsBatch: <Schema, const TQuery extends Query<Schema, DirectusNotification<Schema>>>(items: NestedPartial<DirectusNotification<Schema>>[], query?: TQuery) => RestCommand<UpdateNotificationOutput<Schema, TQuery>[], Schema>;
/**
* Update an existing notification.
* @param key
* @param item
* @param query
* @returns Returns the notification object for the updated notification.
* @throws Will throw if key is empty
*/
declare const updateNotification: <Schema, const TQuery extends Query<Schema, DirectusNotification<Schema>>>(key: DirectusNotification<Schema>["id"], item: NestedPartial<DirectusNotification<Schema>>, query?: TQuery) => RestCommand<UpdateNotificationOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdateNotificationOutput, updateNotification, updateNotifications, updateNotificationsBatch };
//# sourceMappingURL=notifications.d.ts.map