import { UnpackList } from "./utils.js";
import { ItemType, RelationalFields } from "./schema.js";
import { MergeObjects, Query } from "./query.js";

//#region src/types/deep.d.ts

/**
 * Deep filter object
 */
type QueryDeep<Schema, Item> = UnpackList<Item> extends infer FlatItem ? RelationalFields<Schema, FlatItem> extends never ? never : { [Field in RelationalFields<Schema, FlatItem> as ExtractCollection<Schema, FlatItem[Field]> extends any[] ? Field : never]?: ExtractCollection<Schema, FlatItem[Field]> extends infer CollectionItem ? Query<Schema, CollectionItem> extends infer TQuery ? MergeObjects<QueryDeep<Schema, CollectionItem>, { [Key in keyof Omit<TQuery, 'deep' | 'alias' | 'fields'> as `_${string & Key}`]: TQuery[Key] }> : never : never } : never;
type ExtractCollection<Schema, Item> = Extract<Item, ItemType<Schema>>;
//#endregion
export { QueryDeep };
//# sourceMappingURL=deep.d.ts.map