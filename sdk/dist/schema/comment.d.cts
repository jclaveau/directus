import { DirectusUser } from "./user.cjs";
import { DirectusCollection } from "./collection.cjs";
import { MergeCoreCollection } from "../types/schema.cjs";

//#region src/schema/comment.d.ts
type DirectusComment<Schema> = MergeCoreCollection<Schema, 'directus_comments', {
  id: string;
  collection: DirectusCollection<Schema> | string;
  item: string;
  comment: string;
  date_created: 'datetime' | null;
  date_updated: 'datetime' | null;
  user_created: DirectusUser<Schema> | string | null;
  user_updated: DirectusUser<Schema> | string | null;
}>;
//#endregion
export { DirectusComment };
//# sourceMappingURL=comment.d.cts.map