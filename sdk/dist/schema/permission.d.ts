import { DirectusPolicy } from "./policy.js";
import { MergeCoreCollection } from "../types/schema.js";

//#region src/schema/permission.d.ts
type DirectusPermission<Schema = any> = MergeCoreCollection<Schema, 'directus_permissions', {
  id: number;
  policy: DirectusPolicy<Schema> | string | null;
  collection: string;
  action: string;
  permissions: Record<string, any> | null;
  validation: Record<string, any> | null;
  presets: Record<string, any> | null;
  fields: string[] | null;
}>;
//#endregion
export { DirectusPermission };
//# sourceMappingURL=permission.d.ts.map