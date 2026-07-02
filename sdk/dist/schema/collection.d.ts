import { DirectusField } from "./field.js";
import { NestedPartial } from "../types/utils.js";
import { MergeCoreCollection } from "../types/schema.js";

//#region src/schema/collection.d.ts
type DirectusCollection<Schema = any> = {
  collection: string;
  meta: MergeCoreCollection<Schema, 'directus_collections', {
    collection: string;
    icon: string | null;
    note: string | null;
    display_template: string | null;
    hidden: boolean;
    singleton: boolean;
    translations: CollectionMetaTranslationType[] | null;
    archive_field: string | null;
    archive_app_filter: boolean;
    archive_value: string | null;
    unarchive_value: string | null;
    sort_field: string | null;
    accountability: string | null;
    color: string | null;
    item_duplication_fields: string[] | null;
    sort: number | null;
    group: string | null;
    collapse: string;
    preview_url: string | null;
    versioning: boolean;
  }>;
  schema: ({
    name: string;
    comment: string | null;
  } & Record<string, unknown>) | null;
  fields?: NestedPartial<DirectusField<Schema>>[];
};
type CollectionMetaTranslationType = {
  language: string;
  plural: string;
  singular: string;
  translation: string;
};
//#endregion
export { CollectionMetaTranslationType, DirectusCollection };
//# sourceMappingURL=collection.d.ts.map