import { DirectusWebhook } from "../../../schema/webhook.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/read/webhooks.d.ts
type ReadWebhookOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusWebhook<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * List all Webhooks that exist in Directus.
 * @param query The query parameters
 * @returns An array of up to limit Webhook objects. If no items are available, data will be an empty array.
 */
declare const readWebhooks: <Schema, const TQuery extends Query<Schema, DirectusWebhook<Schema>>>(query?: TQuery) => RestCommand<ReadWebhookOutput<Schema, TQuery>[], Schema>;
/**
 * List an existing Webhook by primary key.
 * @param key The primary key of the dashboard
 * @param query The query parameters
 * @returns Returns a Webhook object if a valid primary key was provided.
 * @throws Will throw if key is empty
 */
declare const readWebhook: <Schema, const TQuery extends Query<Schema, DirectusWebhook<Schema>>>(key: DirectusWebhook<Schema>["id"], query?: TQuery) => RestCommand<ReadWebhookOutput<Schema, TQuery>, Schema>;
//#endregion
export { ReadWebhookOutput, readWebhook, readWebhooks };
//# sourceMappingURL=webhooks.d.ts.map