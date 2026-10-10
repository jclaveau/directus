import { DirectusUser } from "./user.js";
import { DirectusRole } from "./role.js";
import { MergeCoreCollection } from "../types/schema.js";

//#region src/schema/share.d.ts
type DirectusShare<Schema = any> = MergeCoreCollection<Schema, 'directus_shares', {
  id: string;
  name: string | null;
  collection: string | null;
  item: string | null;
  role: DirectusRole<Schema> | string | null;
  password: string | null;
  user_created: DirectusUser<Schema> | string | null;
  date_created: 'datetime' | null;
  date_start: 'datetime' | null;
  date_end: 'datetime' | null;
  times_used: number | null;
  max_uses: number | null;
}>;
//#endregion
export { DirectusShare };
//# sourceMappingURL=share.d.ts.map