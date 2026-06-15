import { DirectusWebhook } from "../../../schema/webhook.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/update/webhooks.d.ts
type UpdateWebhookOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusWebhook<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update multiple existing webhooks.
* @param keys
* @param item
* @param query
* @returns Returns the webhook objects for the updated webhooks.
* @throws Will throw if keys is empty
*/
declare const updateWebhooks: <Schema, const TQuery extends Query<Schema, DirectusWebhook<Schema>>>(keys: DirectusWebhook<Schema>["id"][], item: Partial<DirectusWebhook<Schema>>, query?: TQuery) => RestCommand<UpdateWebhookOutput<Schema, TQuery>[], Schema>;
/**
* Update an existing webhook.
* @param key
* @param item
* @param query
* @returns Returns the webhook object for the updated webhook.
* @throws Will throw if key is empty
*/
declare const updateWebhook: <Schema, const TQuery extends Query<Schema, DirectusWebhook<Schema>>>(key: DirectusWebhook<Schema>["id"], item: Partial<DirectusWebhook<Schema>>, query?: TQuery) => RestCommand<UpdateWebhookOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdateWebhookOutput, updateWebhook, updateWebhooks };
//# sourceMappingURL=webhooks.d.cts.map