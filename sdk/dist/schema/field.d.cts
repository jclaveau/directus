import { MergeCoreCollection } from "../types/schema.cjs";

//#region src/schema/field.d.ts
type DirectusField<Schema = any> = {
  collection: string;
  field: string;
  type: string;
  meta: MergeCoreCollection<Schema, "directus_fields", {
    id: number;
    collection: string;
    field: string;
    special: string[] | null;
    interface: string | null;
    options: Record<string, any> | null;
    display: string | null;
    display_options: Record<string, any> | null;
    readonly: boolean;
    hidden: boolean;
    sort: number | null;
    width: string | null;
    translations: FieldMetaTranslationType[] | null;
    note: string | null;
    conditions: FieldMetaConditionType[] | null;
    required: boolean;
    searchable: boolean;
    group: string | null;
    validation: Record<string, any> | null;
    validation_message: string | null;
  }>;
  schema: {
    name: string;
    table: string;
    schema: string;
    data_type: string;
    is_nullable: boolean;
    default_value: any | null;
    is_indexed: boolean;
    is_generated: boolean;
    generation_expression: unknown | null;
    max_length: number | null;
    comment: string | null;
    numeric_precision: number | null;
    numeric_scale: number | null;
    is_unique: boolean;
    is_primary_key: boolean;
    has_auto_increment: boolean;
    foreign_key_schema: string | null;
    foreign_key_table: string | null;
    foreign_key_column: string | null;
  };
};
type FieldMetaConditionType = {
  hidden: boolean;
  name: string;
  options: FieldMetaConditionOptionType;
  readonly: boolean;
  required: boolean;
  rule: unknown;
};
type FieldMetaConditionOptionType = {
  clear: boolean;
  font: string;
  iconLeft?: string;
  iconRight?: string;
  masked: boolean;
  placeholder: string;
  slug: boolean;
  softLength?: number;
  trim: boolean;
};
type FieldMetaTranslationType = {
  language: string;
  translation: string;
};
//#endregion
export { DirectusField, FieldMetaConditionOptionType, FieldMetaConditionType, FieldMetaTranslationType };
//# sourceMappingURL=field.d.cts.map