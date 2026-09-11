import { DirectusUser } from "./user.js";
import { DirectusAccess } from "./access.js";
import { MergeCoreCollection } from "../types/schema.js";

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
//# sourceMappingURL=role.d.ts.map