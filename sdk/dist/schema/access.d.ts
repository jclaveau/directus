import { DirectusUser } from "./user.js";
import { DirectusRole } from "./role.js";
import { DirectusPolicy } from "./policy.js";
import { MergeCoreCollection } from "../types/schema.js";

//#region src/schema/access.d.ts
type DirectusAccess<Schema = any> = MergeCoreCollection<Schema, 'directus_access', {
  id: string;
  role: string | DirectusRole<Schema>;
  user: string | DirectusUser<Schema>;
  policy: string | DirectusPolicy<Schema>;
  sort: number;
}>;
//#endregion
export { DirectusAccess };
//# sourceMappingURL=access.d.ts.map