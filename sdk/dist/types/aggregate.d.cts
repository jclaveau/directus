import { UnpackList } from "./utils.cjs";
import { AllCollections, GetCollection, RelationalFields } from "./schema.cjs";
import { ArrayFunctions, DateTimeFunctions, MappedFieldNames, MappedFunctionFields } from "./functions.cjs";
import { LiteralFields } from "./fields.cjs";
import { Query } from "./query.cjs";

//#region src/types/aggregate.d.ts
type GroupingFunctions = {
  date: 'year' | 'month' | 'week' | 'day' | 'weekday' | 'hour' | 'minute' | 'second';
  array: 'count';
};
type AggregationTypes = {
  count: {
    output: string | null;
    wildcard: true;
  };
  countDistinct: {
    output: string | null;
    wildcard: true;
  };
  sum: {
    output: string | null;
    wildcard: never;
  };
  sumDistinct: {
    output: string | null;
    wildcard: never;
  };
  avg: {
    output: string | null;
    wildcard: never;
  };
  avgDistinct: {
    output: string | null;
    wildcard: never;
  };
  min: {
    output: number | null;
    wildcard: never;
  };
  max: {
    output: number | null;
    wildcard: never;
  };
};
/**
 * Aggregation parameters
 */
type AggregateRecord<Fields = string> = { [Func in keyof AggregationTypes]?: Fields | Fields[] | (AggregationTypes[Func]['wildcard'] extends never ? never : '*') };
/**
 * GroupBy parameters
 */
type GroupByFields<Schema, Item$1> = WrappedFields<LiteralFields<Item$1, 'datetime'>, DateTimeFunctions> | WrappedFields<RelationalFields<Schema, Item$1>, ArrayFunctions>;
/**
 * Aggregation input options
 */
type AggregationOptions<Schema, Collection extends AllCollections<Schema>, Fields = (Collection extends keyof Schema ? keyof UnpackList<GetCollection<Schema, Collection>> : string), Item$1 = (Collection extends keyof Schema ? UnpackList<GetCollection<Schema, Collection>> : object)> = {
  aggregate: AggregateRecord<Fields>;
  groupBy?: (Fields | GroupByFields<Schema, Item$1>)[];
  query?: Omit<Query<Schema, Item$1>, 'fields' | 'deep' | 'alias'>;
};
/**
 * Output typing for aggregation
 */
type AggregationOutput<Schema, Collection extends AllCollections<Schema>, Options extends AggregationOptions<Schema, Collection>> = ((Options['groupBy'] extends string[] ? UnpackList<GetCollection<Schema, Collection>> extends infer Item ? Item extends object ? MappedFunctionFields<Schema, Item> extends infer FieldMap ? MappedFieldNames<Schema, Item> extends infer NamesMap ? { [Field in UnpackList<Options['groupBy']> as TranslateFunctionField<FieldMap, Field>]: TranslateFunctionField<NamesMap, Field> extends keyof Item ? Item[TranslateFunctionField<NamesMap, Field>] : never } : never : never : never : never : object) & { [Func in keyof Options['aggregate']]: Func extends keyof AggregationTypes ? Options['aggregate'][Func] extends string[] ? { [Field in UnpackList<Options['aggregate'][Func]>]: Field extends '*' ? AggregationTypes[Func]['output'] : { [SubField in Field]: AggregationTypes[Func]['output'] }[Field] } : Options['aggregate'][Func] extends string ? Options['aggregate'][Func] extends '*' ? AggregationTypes[Func]['output'] : { [SubField in Options['aggregate'][Func]]: AggregationTypes[Func]['output'] }[Options['aggregate'][Func]] : never : never })[];
/**
 * Wrap fields in functions
 */
type WrappedFields<Fields, Funcs> = Fields extends string ? Funcs extends string ? `${Funcs}(${Fields})` : never : never;
/**
 * Translate function names based on provided map
 */
type TranslateFunctionField<FieldMap$1, Field$1> = Field$1 extends keyof FieldMap$1 ? FieldMap$1[Field$1] extends string ? FieldMap$1[Field$1] : never : Field$1 extends string ? Field$1 : never;
//#endregion
export { AggregateRecord, AggregationOptions, AggregationOutput, AggregationTypes, GroupByFields, GroupingFunctions };
//# sourceMappingURL=aggregate.d.cts.map