import { DirectusUser } from "./user.js";
import { DirectusRole } from "./role.js";
import { MergeCoreCollection } from "../types/schema.js";

//#region src/schema/preset.d.ts
type DirectusPreset<Schema = any> = MergeCoreCollection<Schema, 'directus_presets', {
  id: number;
  bookmark: string | null;
  user: DirectusUser<Schema> | string | null;
  role: DirectusRole<Schema> | string | null;
  collection: string | null;
  search: string | null;
  layout: string | null;
  layout_query: Record<string, any> | null;
  layout_options: Record<string, any> | null;
  refresh_interval: number | null;
  filter: Record<string, any> | null;
  icon: string | null;
  color: string | null;
}>;
//#endregion
export { DirectusPreset };
//# sourceMappingURL=preset.d.ts.map