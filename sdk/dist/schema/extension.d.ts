import { MergeCoreCollection } from "../types/schema.js";

//#region src/schema/extension.d.ts
type DirectusExtension<Schema = any> = {
  id: string;
  bundle: string | null;
  schema: ExtensionSchema | null;
  meta: MergeCoreCollection<Schema, "directus_extensions", {
    id: string;
    source: "module" | "registry" | "local";
    enabled: boolean;
    bundle: string | null;
    folder: string;
  }>;
};
type ExtensionSchema = {
  type: ExtensionTypes;
  local: boolean;
  version?: string;
};
type ExtensionTypes = "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
//#endregion
export { DirectusExtension, ExtensionSchema, ExtensionTypes };
//# sourceMappingURL=extension.d.ts.map