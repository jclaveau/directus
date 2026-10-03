import { DirectusNotification } from "../../../schema/notification.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/read/notifications.d.ts
type ReadNotificationOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusNotification<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * List all notifications that exist in Directus.
 * @param query The query parameters
 * @returns An array of up to limit notification objects. If no items are available, data will be an empty array.
 */
declare const readNotifications: <Schema, const TQuery extends Query<Schema, DirectusNotification<Schema>>>(query?: TQuery) => RestCommand<ReadNotificationOutput<Schema, TQuery>[], Schema>;
/**
 * List an existing notification by primary key.
 * @param key The primary key of the dashboard
 * @param query The query parameters
 * @returns Returns the requested notification object.
 * @throws Will throw if key is empty
 */
declare const readNotification: <Schema, const TQuery extends Query<Schema, DirectusNotification<Schema>>>(key: DirectusNotification<Schema>["id"], query?: TQuery) => RestCommand<ReadNotificationOutput<Schema, TQuery>, Schema>;
//#endregion
export { ReadNotificationOutput, readNotification, readNotifications };
//# sourceMappingURL=notifications.d.cts.map