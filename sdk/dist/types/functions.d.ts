import { Merge } from "./utils.js";
import { ItemType, RelationalFields } from "./schema.js";
import { LiteralFields } from "./fields.js";

//#region src/types/functions.d.ts

/**
 * Available query functions
 */
type DateTimeFunctions = 'year' | 'month' | 'week' | 'day' | 'weekday' | 'hour' | 'minute' | 'second';
type ArrayFunctions = 'count';
type QueryFunctions = {
  datetime: DateTimeFunctions;
  json: ArrayFunctions;
  csv: ArrayFunctions;
};
/**
 * Permute [function, field] combinations
 */
type PermuteFields<Fields, Funcs> = Fields extends string ? Funcs extends string ? [Fields, Funcs] : never : never;
/**
 * Get all many relations on an item
 */
type RelationalFunctions<Schema, Item> = keyof { [Key in RelationalFields<Schema, Item> as Extract<Item[Key], ItemType<Schema>> extends any[] ? Key : never]: Key };
/**
 * Create a map of function fields and their resulting output names
 */
type TranslateFunctionFields<Fields, Funcs> = { [F in PermuteFields<Fields, Funcs> as `${F[1]}(${F[0]})`]: `${F[0]}_${F[1]}` };
/**
 * Combine the various function types
 */
type FunctionFields<Schema, Item> = { [Type in keyof QueryFunctions]: TypeFunctionFields<Item, Type> }[keyof QueryFunctions] | keyof TranslateFunctionFields<RelationalFunctions<Schema, Item>, ArrayFunctions>;
/**
 *
 */
type TypeFunctionFields<Item, Type$1 extends keyof QueryFunctions> = keyof TranslateFunctionFields<LiteralFields<Item, Type$1>, QueryFunctions[Type$1]>;
/**
 * Map all possible function fields on an item
 */
type MappedFunctionFields<Schema, Item> = Merge<TranslateFunctionFields<RelationalFunctions<Schema, Item>, ArrayFunctions>, TranslateFunctionFields<LiteralFields<Item, 'datetime'>, DateTimeFunctions> & TranslateFunctionFields<LiteralFields<Item, 'json' | 'csv'>, ArrayFunctions>>;
/**
 * Create a map of function fields with its original field name
 */
type FunctionFieldNames<Fields, Funcs> = { [F in PermuteFields<Fields, Funcs> as `${F[1]}(${F[0]})`]: F[0] };
/**
 * Map all possible function fields to name on an item
 */
type MappedFieldNames<Schema, Item> = Merge<FunctionFieldNames<RelationalFunctions<Schema, Item>, ArrayFunctions>, FunctionFieldNames<LiteralFields<Item, 'datetime'>, DateTimeFunctions> & FunctionFieldNames<LiteralFields<Item, 'json' | 'csv'>, ArrayFunctions>>;
//#endregion
export { ArrayFunctions, DateTimeFunctions, FunctionFields, MappedFieldNames, MappedFunctionFields, PermuteFields, QueryFunctions, TypeFunctionFields };
//# sourceMappingURL=functions.d.ts.map