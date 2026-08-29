import { IfNever, UnpackList } from "./utils.js";
import { ItemType, RelationalFields, RemoveRelationships } from "./schema.js";
import { FunctionFields } from "./functions.js";
import { ExtractItem } from "./query.js";

//#region src/types/fields.d.ts

/**
 * Fields querying, including nested relational fields
 */
type QueryFields<Schema, Item> = WrapQueryFields<Schema, Item, QueryFieldsRelational<Schema, UnpackList<Item>>>;
/**
 * Wrap array of fields
 */
type WrapQueryFields<Schema, Item, NestedFields> = readonly ('*' | keyof UnpackList<Item> | NestedFields | FunctionFields<Schema, UnpackList<Item>>)[];
/**
 * Object of nested relational fields in a given Item with it's own fields available for selection
 */
type QueryFieldsRelational<Schema, Item> = IfNever<RelationalFields<Schema, Item>, never, { [Key in RelationalFields<Schema, Item>]?: Extract<Item[Key], ItemType<Schema>> extends infer RelatedCollection ? RelatedCollection extends any[] ? HasManyToAnyRelation<RelatedCollection> extends never ? QueryFields<Schema, RelatedCollection> : ManyToAnyFields<Schema, RelatedCollection> : QueryFields<Schema, RelatedCollection> : never }>;
/**
 * Deal with many-to-any relational fields
 */
type ManyToAnyFields<Schema, Item> = ExtractItem<Schema, Item> extends infer TItem ? TItem extends object ? 'collection' extends keyof TItem ? 'item' extends keyof TItem ? WrapQueryFields<Schema, TItem, Omit<QueryFieldsRelational<Schema, UnpackList<Item>>, 'item'> & {
  item?: { [Collection in keyof Schema as Collection extends TItem['collection'] ? Collection : never]?: QueryFields<Schema, Schema[Collection]> };
}> : never : never : never : never;
/**
 * Determine whether a field definition has a many-to-any relation
 * TODO try making this dynamic somehow instead of relying on "item" as key
 */
type HasManyToAnyRelation<Item> = UnpackList<Item> extends infer TItem ? TItem extends object ? 'collection' extends keyof TItem ? 'item' extends keyof TItem ? true : never : never : never : never;
/**
 * Returns true if the Fields has any nested field
 */
type HasNestedFields<Fields> = UnpackList<Fields> extends infer Field ? (Field extends object ? true : never) : never;
/**
 * Return all keys if Fields is undefined or contains '*'
 */
type FieldsWildcard<Item extends object, Fields> = unknown extends Fields ? keyof Item : UnpackList<Fields> extends infer Field ? Field extends undefined ? keyof Item : Field extends '*' ? keyof Item : Field extends string ? Field : never : never;
/**
 * Returns the relational fields from the fields list
 */
type PickRelationalFields<Fields> = MergeRelations<UnpackList<Fields> extends infer Field ? (Field extends object ? Field : never) : never>;
type MergeRelations<RelationalFields$1 extends object | never> = { [Key in AllKeys<RelationalFields$1>]: PickType<RelationalFields$1, Key> };
type PickType<T, K extends AllKeys<T>> = T extends { [k in K]?: any } ? T[K] : undefined;
type AllKeys<T> = T extends any ? keyof T : never;
/**
 * Extract the required fields from an item
 */
type PickFlatFields<Schema, Item, Fields> = Extract<Fields, keyof Item> extends never ? never : Pick<RemoveRelationships<Schema, Item>, Extract<Fields, keyof Item>>;
/**
 * Extract a specific literal type from a collection
 */
type LiteralFields<Item, Type extends string> = { [Key in keyof Item]: Extract<Item[Key], Type>[] extends never[] ? never : Key }[keyof Item];
//#endregion
export { FieldsWildcard, HasManyToAnyRelation, HasNestedFields, LiteralFields, ManyToAnyFields, PickFlatFields, PickRelationalFields, QueryFields, QueryFieldsRelational, WrapQueryFields };
//# sourceMappingURL=fields.d.ts.map