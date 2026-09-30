import { DirectusPermission } from "./permission.cjs";
import { DirectusUser } from "./user.cjs";
import { DirectusRole } from "./role.cjs";
import { MergeCoreCollection } from "../types/schema.cjs";

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
//# sourceMappingURL=policy.d.cts.map