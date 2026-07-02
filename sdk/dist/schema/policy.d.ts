import { DirectusPermission } from "./permission.js";
import { DirectusUser } from "./user.js";
import { DirectusRole } from "./role.js";
import { MergeCoreCollection } from "../types/schema.js";

//#region src/schema/policy.d.ts
type DirectusPolicy<Schema> = MergeCoreCollection<Schema, 'directus_policies', {
  id: string;
  name: string;
  icon: string;
  description: string | null;
  ip_access: string | null;
  enforce_tfa: boolean;
  admin_access: boolean;
  app_access: boolean;
  permissions: number[] | DirectusPermission<Schema>[];
  users: string[] | DirectusUser<Schema>[];
  roles: string[] | DirectusRole<Schema>[];
}>;
//#endregion
export { DirectusPolicy };
//# sourceMappingURL=policy.d.ts.map