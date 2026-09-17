import { MergeCoreCollection } from "../types/schema.js";

//#region src/schema/folder.d.ts
type DirectusFolder<Schema = any> = MergeCoreCollection<Schema, 'directus_folders', {
  id: string;
  name: string;
  parent: DirectusFolder<Schema> | string | null;
}>;
//#endregion
export { DirectusFolder };
//# sourceMappingURL=folder.d.ts.map