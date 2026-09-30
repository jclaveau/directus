import { MergeCoreCollection } from "../types/schema.js";

//#region src/schema/webhook.d.ts
type DirectusWebhook<Schema = any> = MergeCoreCollection<Schema, 'directus_webhooks', {
  id: number;
  name: string;
  method: string;
  url: string;
  status: string;
  data: boolean;
  actions: string | string[];
  collections: string | string[];
  headers: Record<string, any> | null;
}>;
//#endregion
export { DirectusWebhook };
//# sourceMappingURL=webhook.d.ts.map