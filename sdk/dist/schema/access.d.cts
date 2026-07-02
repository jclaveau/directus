import { DirectusUser } from "./user.cjs";
import { DirectusRole } from "./role.cjs";
import { DirectusPolicy } from "./policy.cjs";
import { MergeCoreCollection } from "../types/schema.cjs";

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
//# sourceMappingURL=access.d.cts.map