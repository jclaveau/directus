import { DirectusPermission } from "./permission.js";
import { DirectusAccess } from "./access.js";
import { MergeCoreCollection } from "../types/schema.js";

//#region src/schema/policy.d.ts
type DirectusPolicy<Schema> = MergeCoreCollection<Schema, "directus_policies", {
  id: string;
  name: string;
  icon: string;
  description: string | null;
  ip_access: string | null;
  enforce_tfa: boolean;
  admin_access: boolean;
  app_access: boolean;
  permissions: number[] | DirectusPermission<Schema>[];
  users: string[] | DirectusAccess<Schema>[];
  roles: string[] | DirectusAccess<Schema>[];
}>;
//#endregion
export { DirectusPolicy };
//# sourceMappingURL=policy.d.ts.map