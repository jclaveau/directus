import { MergeCoreCollection } from "../types/schema.js";

//#region src/schema/translation.d.ts
type DirectusTranslation<Schema = any> = MergeCoreCollection<Schema, 'directus_translations', {
  id: string;
  language: string;
  key: string;
  value: string;
}>;
//#endregion
export { DirectusTranslation };
//# sourceMappingURL=translation.d.ts.map