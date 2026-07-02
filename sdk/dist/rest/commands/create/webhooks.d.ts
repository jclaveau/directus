import { DirectusWebhook } from "../../../schema/webhook.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/create/webhooks.d.ts
type CreateWebhookOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusWebhook<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * Create multiple new webhooks.
 *
 * @param items The webhooks to create
 * @param query Optional return data query
 *
 * @returns Returns the webhook objects for the created webhooks.
 */
declare const createWebhooks: <Schema, const TQuery extends Query<Schema, DirectusWebhook<Schema>>>(items: Partial<DirectusWebhook<Schema>>[], query?: TQuery) => RestCommand<CreateWebhookOutput<Schema, TQuery>[], Schema>;
/**
 * Create a new webhook.
 *
 * @param item The webhook to create
 * @param query Optional return data query
 *
 * @returns Returns the webhook object for the created webhook.
 */
declare const createWebhook: <Schema, const TQuery extends Query<Schema, DirectusWebhook<Schema>>>(item: Partial<DirectusWebhook<Schema>>, query?: TQuery) => RestCommand<CreateWebhookOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreateWebhookOutput, createWebhook, createWebhooks };
//# sourceMappingURL=webhooks.d.ts.map