import { IfAny, IsNullable, Merge, Mutable, Prettify, UnpackList } from "./utils.js";
import { ItemType, RemoveRelationships } from "./schema.js";
import { MappedFunctionFields } from "./functions.js";
import { FieldsWildcard, HasManyToAnyRelation, PickRelationalFields } from "./fields.js";

//#region src/types/output.d.ts

/**
 * Apply the configured fields query parameter on a given Item type
 */
type ApplyQueryFields<Schema, Collection extends object, ReadonlyFields, CollectionItem extends object = UnpackList<Collection>, Fields = UnpackList<Mutable<ReadonlyFields>>, RelationalFields = PickRelationalFields<Fields>, RelationalKeys extends keyof RelationalFields = (RelationalFields extends never ? never : keyof RelationalFields), FlatFields extends keyof CollectionItem = FieldsWildcard<CollectionItem, Exclude<Fields, RelationalKeys>>> = IfAny<Schema, Record<string, any>, Prettify<Merge<MappedFunctionFields<Schema, CollectionItem> extends infer FF ? MapFlatFields<RemoveRelationships<Schema, CollectionItem>, FlatFields, FF extends Record<string, string> ? FF : Record<string, string>> : never, RelationalFields extends never ? never : { [Field in keyof RelationalFields]: Field extends keyof CollectionItem ? Extract<CollectionItem[Field], ItemType<Schema>> extends infer RelatedCollection ? RelationNullable<CollectionItem[Field], RelatedCollection extends any[] ? HasManyToAnyRelation<RelatedCollection> extends never ? ApplyNestedQueryFields<Schema, RelatedCollection, RelationalFields[Field]>[] | null : ApplyManyToAnyFields<Schema, RelatedCollection, RelationalFields[Field]>[] : ApplyNestedQueryFields<Schema, RelatedCollection, RelationalFields[Field]>> : never : never }>>>;
/**
 * Apply the configured fields query parameter on a many to any relation
 */
type ApplyManyToAnyFields<Schema, JunctionCollection, FieldsList, Junction = UnpackList<JunctionCollection>> = Junction extends object ? PickRelationalFields<FieldsList> extends never ? ApplyQueryFields<Schema, Junction, Readonly<UnpackList<FieldsList>>> : 'item' extends keyof PickRelationalFields<FieldsList> ? PickRelationalFields<FieldsList>['item'] extends infer ItemFields ? Omit<ApplyQueryFields<Schema, Omit<Junction, 'item'>, Readonly<UnpackList<FieldsList>>>, 'item'> & ('collection' extends UnpackList<FieldsList> ? { [Scope in keyof ItemFields]: {
  collection: Scope;
  item: Scope extends keyof Schema ? ApplyNestedQueryFields<Schema, Schema[Scope], ItemFields[Scope]> : never;
} }[keyof ItemFields] : {
  item: { [Scope in keyof ItemFields]: Scope extends keyof Schema ? ApplyNestedQueryFields<Schema, Schema[Scope], ItemFields[Scope]> : never }[keyof ItemFields];
}) : never : ApplyQueryFields<Schema, Junction, Readonly<UnpackList<FieldsList>>> : never;
/**
 * wrapper to aid in recursion
 */
type ApplyNestedQueryFields<Schema, Collection, Fields> = Collection extends object ? ApplyQueryFields<Schema, Collection, Readonly<UnpackList<Fields>>> : never;
/**
 * Carry nullability of
 */
type RelationNullable<Relation, Output> = IsNullable<Relation, Output | null, Output>;
/**
 * Map literal types to actual output types
 */
type MapFlatFields<Item extends object, Fields extends keyof Item, FunctionMap extends Record<string, string>> = { [F in Fields as F extends keyof FunctionMap ? FunctionMap[F] : F]: F extends keyof FunctionMap ? FunctionOutputType : Extract<Item[F], keyof FieldOutputMap> extends infer A ? A[] extends never[] ? Item[F] : A extends keyof FieldOutputMap ? FieldOutputMap[A] | Exclude<Item[F], A> : Item[F] : Item[F] };
type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonPrimitive[] | {
  [key: string]: JsonValue;
};
/**
 * Output map for specific literal types
 */
type FieldOutputMap = {
  json: JsonValue;
  csv: string[];
  datetime: string;
};
type FunctionOutputType = number;
//#endregion
export { ApplyManyToAnyFields, ApplyNestedQueryFields, ApplyQueryFields, FieldOutputMap, MapFlatFields, RelationNullable };
//# sourceMappingURL=output.d.ts.map