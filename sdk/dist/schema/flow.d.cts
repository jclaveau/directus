import { DirectusUser } from "./user.cjs";
import { DirectusOperation } from "./operation.cjs";
import { MergeCoreCollection } from "../types/schema.cjs";

//#region src/schema/flow.d.ts
type DirectusFlow<Schema = any> = MergeCoreCollection<Schema, 'directus_flows', {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  description: string | null;
  status: string;
  trigger: string | null;
  accountability: string | null;
  options: Record<string, any> | null;
  operation: DirectusOperation<Schema> | string | null;
  date_created: 'datetime' | null;
  user_created: DirectusUser<Schema> | string | null;
}>;
//#endregion
export { DirectusFlow };
//# sourceMappingURL=flow.d.cts.map