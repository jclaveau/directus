import { IfNever, IsDateTime, IsNumber, IsString, Merge, UnpackList } from "./utils.js";
import { RelationalFields } from "./schema.js";
import { MappedFieldNames } from "./functions.js";
import { FieldOutputMap } from "./output.js";

//#region src/types/filters.d.ts

/**
 * Filters
 */
type QueryFilter<Schema, Item> = WrapLogicalFilters<NestedQueryFilter<Schema, Item>>;
/**
 * Query filters without logical filters
 */
type NestedQueryFilter<Schema, Item> = UnpackList<Item> extends infer FlatItem ? Partial<Merge<{ [Field in keyof FlatItem]?: NestedRelationalFilter<Schema, FlatItem, Field> }, MappedFieldNames<Schema, Item> extends infer Funcs ? { [Func in keyof Funcs]?: Funcs[Func] extends infer Field ? Field extends keyof FlatItem ? NestedRelationalFilter<Schema, FlatItem, Field> : never : never } : never>> : never;
/**
 * Allow for relational filters
 */
type NestedRelationalFilter<Schema, Item, Field$1 extends keyof Item> = (Field$1 extends RelationalFields<Schema, Item> ? WrapRelationalFilters<NestedQueryFilter<Schema, Item[Field$1]>> : never) | FilterOperators<Item[Field$1]>;
/**
 * All regular filter operators
 *
 * TODO would love to filter this based on field type but thats not accurate enough in the schema atm
 */
type FilterOperators<FieldType, T = (FieldType extends keyof FieldOutputMap ? FieldOutputMap[FieldType] : FieldType)> = MapFilterOperators<{
  _eq: T;
  _neq: T;
  _gt: IsDateTime<FieldType, string, IsNumber<T, number, never>>;
  _gte: IsDateTime<FieldType, string, IsNumber<T, number, never>>;
  _lt: IsDateTime<FieldType, string, IsNumber<T, number, never>>;
  _lte: IsDateTime<FieldType, string, IsNumber<T, number, never>>;
  _in: T[];
  _nin: T[];
  _between: IsDateTime<FieldType, [T, T], IsNumber<T, [T, T], never>>;
  _nbetween: IsDateTime<FieldType, [T, T], IsNumber<T, [T, T], never>>;
  _contains: IsDateTime<FieldType, never, IsString<T, string, never>>;
  _ncontains: IsDateTime<FieldType, never, IsString<T, string, never>>;
  _icontains: IsDateTime<FieldType, never, IsString<T, string, never>>;
  _starts_with: IsDateTime<FieldType, never, IsString<T, string, never>>;
  _istarts_with: IsDateTime<FieldType, never, IsString<T, string, never>>;
  _nstarts_with: IsDateTime<FieldType, never, IsString<T, string, never>>;
  _nistarts_with: IsDateTime<FieldType, never, IsString<T, string, never>>;
  _ends_with: IsDateTime<FieldType, never, IsString<T, string, never>>;
  _iends_with: IsDateTime<FieldType, never, IsString<T, string, never>>;
  _nends_with: IsDateTime<FieldType, never, IsString<T, string, never>>;
  _niends_with: IsDateTime<FieldType, never, IsString<T, string, never>>;
  _empty: boolean;
  _nempty: boolean;
  _nnull: boolean;
  _null: boolean;
  _intersects: T;
  _nintersects: T;
  _intersects_bbox: T;
  _nintersects_bbox: T;
}>;
type MapFilterOperators<Filters extends object> = { [Key in keyof Filters as IfNever<Filters[Key], never, Key>]?: Filters[Key] };
/**
 * Relational filter operators
 */
type RelationalFilterOperators = '_some' | '_none';
type WrapRelationalFilters<Filters> = { [Operator in RelationalFilterOperators]?: Filters } | Filters;
/**
 * Logical filter operations
 */
type LogicalFilterOperators = '_or' | '_and';
type WrapLogicalFilters<Filters extends object> = { [Operator in LogicalFilterOperators]?: WrapLogicalFilters<Filters>[] } | Filters;
//#endregion
export { FilterOperators, LogicalFilterOperators, NestedQueryFilter, NestedRelationalFilter, QueryFilter, RelationalFilterOperators, WrapLogicalFilters, WrapRelationalFilters };
//# sourceMappingURL=filters.d.ts.map