import { MergeCoreCollection } from "../types/schema.js";

//#region src/schema/relation.d.ts
type DirectusRelation<Schema = any> = {
  collection: string;
  field: string;
  related_collection: string;
  meta: MergeCoreCollection<Schema, 'directus_relations', {
    id: number;
    junction_field: string | null;
    many_collection: string | null;
    many_field: string | null;
    one_allowed_collections: string | null;
    one_collection: string | null;
    one_collection_field: string | null;
    one_deselect_action: string;
    one_field: string | null;
    sort_field: string | null;
    system: boolean | null;
  }>;
  schema: {
    column: string;
    constraint_name: string;
    foreign_key_column: string;
    foreign_key_schema: string;
    foreign_key_table: string;
    on_delete: string;
    on_update: string;
    table: string;
  };
};
//#endregion
export { DirectusRelation };
//# sourceMappingURL=relation.d.ts.map