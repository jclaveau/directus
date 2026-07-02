import { DirectusUser } from "./user.js";
import { DirectusFlow } from "./flow.js";
import { MergeCoreCollection } from "../types/schema.js";

//#region src/schema/operation.d.ts
type DirectusOperation<Schema = any> = MergeCoreCollection<Schema, 'directus_operations', {
  id: string;
  name: string | null;
  key: string;
  type: string;
  position_x: number;
  position_y: number;
  timestamp: string;
  options: Record<string, any> | null;
  resolve: DirectusOperation<Schema> | string | null;
  reject: DirectusOperation<Schema> | string | null;
  flow: DirectusFlow<Schema> | string;
  date_created: 'datetime' | null;
  user_created: DirectusUser<Schema> | string | null;
}>;
//#endregion
export { DirectusOperation };
//# sourceMappingURL=operation.d.ts.map