import { DirectusVersion } from "./version.js";
import { DirectusActivity } from "./activity.js";
import { MergeCoreCollection } from "../types/schema.js";

//#region src/schema/revision.d.ts
type DirectusRevision<Schema = any> = MergeCoreCollection<Schema, 'directus_revisions', {
  id: number;
  activity: DirectusActivity<Schema> | number;
  collection: string;
  item: string;
  data: Record<string, any> | null;
  delta: Record<string, any> | null;
  parent: DirectusRevision<Schema> | number | null;
  version: DirectusVersion<Schema> | string | null;
}>;
//#endregion
export { DirectusRevision };
//# sourceMappingURL=revision.d.ts.map