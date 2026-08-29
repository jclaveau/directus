import { DirectusUser } from "./user.cjs";
import { DirectusCollection } from "./collection.cjs";
import { MergeCoreCollection } from "../types/schema.cjs";

//#region src/schema/version.d.ts
type DirectusVersion<Schema = any> = MergeCoreCollection<Schema, 'directus_versions', {
  id: string;
  key: string;
  name: string | null;
  collection: DirectusCollection<Schema> | string;
  item: string;
  hash: string;
  date_created: 'datetime' | null;
  date_updated: 'datetime' | null;
  user_created: DirectusUser<Schema> | string | null;
  user_updated: DirectusUser<Schema> | string | null;
  delta: Record<string, any> | null;
}>;
//#endregion
export { DirectusVersion };
//# sourceMappingURL=version.d.cts.map