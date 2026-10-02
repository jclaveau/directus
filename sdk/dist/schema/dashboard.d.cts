import { DirectusUser } from "./user.cjs";
import { MergeCoreCollection } from "../types/schema.cjs";

//#region src/schema/dashboard.d.ts
type DirectusDashboard<Schema = any> = MergeCoreCollection<Schema, 'directus_dashboards', {
  id: string;
  name: string;
  icon: string;
  note: string | null;
  date_created: 'datetime' | null;
  user_created: DirectusUser<Schema> | string | null;
  color: string | null;
}>;
//#endregion
export { DirectusDashboard };
//# sourceMappingURL=dashboard.d.cts.map