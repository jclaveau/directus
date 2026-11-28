import { MergeCoreCollection } from "../types/schema.js";

//#region src/schema/extension.d.ts
type DirectusExtension<Schema = any> = {
  name: string;
  bundle: string | null;
  schema: ExtensionSchema | null;
  meta: MergeCoreCollection<Schema, 'directus_extensions', {
    enabled: boolean;
  }>;
};
type ExtensionSchema = {
  type: ExtensionTypes;
  local: boolean;
  version?: string;
};
type ExtensionTypes = 'interface' | 'display' | 'layout' | 'module' | 'panel' | 'hook' | 'endpoint' | 'operation' | 'bundle';
//#endregion
export { DirectusExtension, ExtensionSchema, ExtensionTypes };
//# sourceMappingURL=extension.d.ts.map