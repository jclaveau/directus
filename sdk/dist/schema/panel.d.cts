import { DirectusUser } from "./user.cjs";
import { DirectusDashboard } from "./dashboard.cjs";
import { MergeCoreCollection } from "../types/schema.cjs";

//#region src/schema/panel.d.ts
type DirectusPanel<Schema = any> = MergeCoreCollection<Schema, 'directus_panels', {
  id: string;
  dashboard: DirectusDashboard<Schema> | string;
  name: string | null;
  icon: string | null;
  color: string | null;
  show_header: boolean;
  note: string | null;
  type: string;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  options: Record<string, any> | null;
  date_created: 'datetime' | null;
  user_created: DirectusUser<Schema> | string | null;
}>;
//#endregion
export { DirectusPanel };
//# sourceMappingURL=panel.d.cts.map