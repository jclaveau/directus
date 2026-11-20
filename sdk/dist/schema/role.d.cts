import { DirectusUser } from "./user.cjs";
import { DirectusAccess } from "./access.cjs";
import { MergeCoreCollection } from "../types/schema.cjs";

//#region src/schema/role.d.ts
type DirectusRole<Schema = any> = MergeCoreCollection<Schema, 'directus_roles', {
  id: string;
  name: string;
  icon: string;
  description: string | null;
  parent: string | DirectusRole<Schema>;
  children: string[] | DirectusRole<Schema>[];
  policies: string[] | DirectusAccess<Schema>[];
  users: string[] | DirectusUser<Schema>[];
}>;
//#endregion
export { DirectusRole };
//# sourceMappingURL=role.d.cts.map