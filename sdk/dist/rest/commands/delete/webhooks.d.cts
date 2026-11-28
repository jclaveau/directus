import { DirectusWebhook } from "../../../schema/webhook.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/delete/webhooks.d.ts

/**
 * Delete multiple existing webhooks.
 * @param keys
 * @returns
 * @throws Will throw if keys is empty
 */
declare const deleteWebhooks: <Schema>(keys: DirectusWebhook<Schema>["id"][]) => RestCommand<void, Schema>;
/**
 * Delete an existing webhook.
 * @param key
 * @returns
 * @throws Will throw if key is empty
 */
declare const deleteWebhook: <Schema>(key: DirectusWebhook<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deleteWebhook, deleteWebhooks };
//# sourceMappingURL=webhooks.d.cts.map