import { DirectusUser } from "./user.js";
import { MergeCoreCollection } from "../types/schema.js";

//#region src/schema/notification.d.ts
type DirectusNotification<Schema = any> = MergeCoreCollection<Schema, 'directus_notifications', {
  id: string;
  timestamp: 'datetime' | null;
  status: string | null;
  recipient: DirectusUser<Schema> | string;
  sender: DirectusUser<Schema> | string | null;
  subject: string;
  message: string | null;
  collection: string | null;
  item: string | null;
}>;
//#endregion
export { DirectusNotification };
//# sourceMappingURL=notification.d.ts.map