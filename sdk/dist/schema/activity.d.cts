import { DirectusUser } from "./user.cjs";
import { DirectusRevision } from "./revision.cjs";
import { MergeCoreCollection } from "../types/schema.cjs";

//#region src/schema/activity.d.ts
type DirectusActivity<Schema = any> = MergeCoreCollection<Schema, 'directus_activity', {
  id: number;
  action: string;
  user: DirectusUser<Schema> | string | null;
  timestamp: 'datetime';
  ip: string | null;
  user_agent: string | null;
  collection: string;
  item: string;
  origin: string | null;
  revisions: DirectusRevision<Schema>[] | number[] | null;
}>;
//#endregion
export { DirectusActivity };
//# sourceMappingURL=activity.d.cts.map