import { MergeCoreCollection } from "../types/schema.cjs";

//#region src/schema/folder.d.ts
type DirectusFolder<Schema = any> = MergeCoreCollection<Schema, 'directus_folders', {
  id: string;
  name: string;
  parent: DirectusFolder<Schema> | string | null;
}>;
//#endregion
export { DirectusFolder };
//# sourceMappingURL=folder.d.cts.map