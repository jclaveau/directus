import { DirectusNotification } from "../../../schema/notification.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/create/notifications.d.ts
type CreateNotificationOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusNotification<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Create multiple new notifications.
*
* @param items The notifications to create
* @param query Optional return data query
*
* @returns Returns the notification object for the created notification.
*/
declare const createNotifications: <Schema, const TQuery extends Query<Schema, DirectusNotification<Schema>>>(items: NestedPartial<DirectusNotification<Schema>>[], query?: TQuery) => RestCommand<CreateNotificationOutput<Schema, TQuery>[], Schema>;
/**
* Create a new notification.
*
* @param item The notification to create
* @param query Optional return data query
*
* @returns Returns the notification object for the created notification.
*/
declare const createNotification: <Schema, const TQuery extends Query<Schema, DirectusNotification<Schema>>>(item: NestedPartial<DirectusNotification<Schema>>, query?: TQuery) => RestCommand<CreateNotificationOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreateNotificationOutput, createNotification, createNotifications };
//# sourceMappingURL=notifications.d.ts.map