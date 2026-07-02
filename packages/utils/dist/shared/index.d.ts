import BaseJoi, { AnySchema, StringSchema as StringSchema$1 } from "joi";
import { Accountability, ClientFilterOperator, Collection, CollectionType, FieldFilter, FieldFunction, Filter, Plural, Policy, RawField, Relation, Role, Type, UnknownObject, User } from "@directus/types";
import { Component } from "vue";

//#region shared/abbreviate-number.d.ts
declare function abbreviateNumber(number: number, decimalPlaces?: number, units?: string[]): string;
//#endregion
//#region shared/add-field-flag.d.ts
/**
 * Add a flag to a field.
 */
declare function addFieldFlag(field: RawField, flag: string): void;
//#endregion
//#region shared/adjust-date.d.ts
/**
 * Adjust a given date by a given change in duration. The adjustment value uses the exact same syntax
 * and logic as Vercel's `ms`.
 *
 * The conversion is lifted straight from `ms`.
 */
declare function adjustDate(date: Date, adjustment: string): Date | undefined;
//#endregion
//#region shared/apply-options-data.d.ts
declare function applyOptionsData(options: Record<string, any>, data: Record<string, any>, skipUndefinedKeys?: string[]): Record<string, any>;
declare function optionToObject<T>(option: T): Exclude<T, string>;
declare function optionToString(option: unknown): string;
//#endregion
//#region shared/array-helpers.d.ts
declare function isIn<T extends readonly string[]>(value: string, array: T): value is T[number];
declare function isTypeIn<T extends {
  type?: string;
}, E extends string>(object: T, array: readonly E[]): object is Extract<T, {
  type?: E;
}>;
//#endregion
//#region shared/compress.d.ts
/**
 * Compress any input object or array down to a minimal size reproduction in a string
 * Inspired by `jsonpack`
 */
declare function compress(obj: Record<string, any> | Record<string, any>[]): string;
declare function decompress(input: string): unknown;
//#endregion
//#region shared/deep-map.d.ts
/**
 * Maps over all values in an array or object recursively and calls the callback on primitive values.
 * The called object will not be mutated. The callback will not be called for primitive values.
 *
 * @example
 * deepMap({a: 1, b: [2]}, (value) => String(value)) // {a: "1", b: ["2"]}
 */
declare function deepMap(object: any, callback: (value: any, key: string | number) => any, context?: any): any;
//#endregion
//#region shared/defaults.d.ts
/**
 * Returns the input source object with the defaults applied
 *
 * @example
 * ```js
 * type Example = {
 * 	optional?: boolean;
 * 	required: boolean;
 * }
 * const input: Example = { required: true };
 * const output = defaults(input, { optional: false });
 * // => { required: true, optional: false }
 * ```
 */
declare const defaults: <T extends object>(obj: T, def: Required<Pick<T, Exclude<keyof T, Exclude<{ [K in keyof T]: T[K] extends Exclude<T[keyof T], undefined> ? K : never }[keyof T], undefined>>>>) => Required<T>;
//#endregion
//#region shared/functions.d.ts
declare const functions: Record<FieldFunction, (val: any) => any>;
//#endregion
//#region shared/generate-joi.d.ts
interface StringSchema extends StringSchema$1 {
  contains(substring: string): this;
  icontains(substring: string): this;
  ncontains(substring: string): this;
}
declare const Joi: typeof BaseJoi;
type JoiOptions = {
  requireAll?: boolean;
};
/**
 * Generate a Joi schema from a filter object.
 *
 * @param {FieldFilter} filter - Field filter object. Note: does not support _and/_or filters.
 * @param {JoiOptions} [options] - Options for the schema generation.
 * @returns {AnySchema} Joi schema.
 */
declare function generateJoi(filter: FieldFilter | null, options?: JoiOptions): AnySchema;
//#endregion
//#region shared/get-collection-type.d.ts
/**
 * Get the type of collection. One of alias | table. (And later: view)
 *
 * @param collection Collection object to get the type of
 * @returns collection type
 */
declare function getCollectionType(collection: Collection): CollectionType;
//#endregion
//#region shared/get-endpoint.d.ts
declare function getEndpoint(collection: string): string;
//#endregion
//#region shared/get-fields-from-template.d.ts
declare function getFieldsFromTemplate(template?: string | null): string[];
//#endregion
//#region shared/get-filter-operators-for-type.d.ts
type GetFilterOperationsForTypeOptions = {
  includeValidation?: boolean;
};
declare function getFilterOperatorsForType(type: Type, opts?: GetFilterOperationsForTypeOptions): ClientFilterOperator[];
//#endregion
//#region shared/get-functions-for-type.d.ts
declare function getFunctionsForType(type: Type): FieldFunction[];
//#endregion
//#region shared/get-output-type-for-function.d.ts
declare function getOutputTypeForFunction(fn: FieldFunction): Type;
//#endregion
//#region shared/get-redacted-string.d.ts
declare const getRedactedString: (key?: string) => string;
declare const REDACTED_TEXT: string;
//#endregion
//#region shared/get-relation-type.d.ts
declare function getRelationType(getRelationOptions: {
  relation: Relation;
  collection: string | null;
  field: string;
}): 'm2o' | 'o2m' | 'm2a' | null;
//#endregion
//#region shared/get-relation.d.ts
declare function getRelations(relations: Relation[], collection: string, field: string): Relation[];
declare function getRelation(relations: Relation[], collection: string, field: string): Relation | undefined;
//#endregion
//#region shared/get-simple-hash.d.ts
/**
 * Generate a simple short hash for a given string
 * This is not cryptographically secure in any way, and has a high chance of collision
 */
declare function getSimpleHash(str: string): string;
//#endregion
//#region shared/get-with-arrays.d.ts
/**
 * Basically the same as `get` from `lodash`, but will convert nested array values to arrays, so for example:
 *
 * @example
 * ```js
 * const obj = { value: [{ example: 1 }, { example: 2 }]}
 * get(obj, 'value.example');
 * // => [1, 2]
 * ```
 */
declare function get(object: Record<string, any> | any[], path: string, defaultValue?: unknown): any;
//#endregion
//#region shared/inject-function-results.d.ts
/**
 * Inject function output fields into a given payload for accurate validation
 *
 * @param payload Any data payload
 * @param filter A single level filter rule to verify against
 *
 * @example
 * ```js
 * const input = { date: '2022-03-29T11:37:56Z' };
 * const filter = { 'year(date)': { _eq: 2022 }}
 * const output = applyFunctions(input, filter);
 * // { date: '2022-03-29T11:37:56Z', 'year(date)': 2022 }
 * ```
 */
declare function injectFunctionResults(payload: Record<string, any>, filter: Filter): Record<string, any>;
//#endregion
//#region shared/is-dynamic-variable.d.ts
declare function isDynamicVariable(value: any): boolean;
//#endregion
//#region shared/is-object.d.ts
declare function isObject(input: unknown): input is UnknownObject;
//#endregion
//#region shared/is-valid-json.d.ts
declare function isValidJSON(input: string): boolean;
//#endregion
//#region shared/is-vue-component.d.ts
declare function isVueComponent(input: unknown): input is Component;
//#endregion
//#region shared/merge-filters.d.ts
declare function mergeFilters(filterA: Filter | null, filterB: Filter | null, strategy?: 'and' | 'or'): Filter | null;
//#endregion
//#region shared/move-in-array.d.ts
declare function moveInArray<T = any>(array: T[], fromIndex: number, toIndex: number): T[];
//#endregion
//#region shared/normalize-path.d.ts
/**
 * Replace windows style backslashes with unix forwards slashes
 */
declare const normalizePath: (path: string, {
  removeLeading
}?: {
  removeLeading: boolean;
}) => string;
//#endregion
//#region shared/number-generator.d.ts
/**
 * Generator function to generate parameter indices.
 */
declare function numberGenerator(): Generator<number, number, number>;
//#endregion
//#region shared/one-line.d.ts
/**
 * Template tag that renders a wrapped source string as a single line: every run of whitespace
 * containing a newline collapses to one space, and the ends are trimmed. Lets a long string (e.g. a
 * test title) be written across several indented source lines — readable, and under a column cap —
 * while the value stays a single line.
 *
 *     oneLine`
 *         null scopedCacheTags falls back to a full flush (unresolvable mutation)
 *     `
 *     // → 'null scopedCacheTags falls back to a full flush (unresolvable mutation)'
 */
declare function oneLine(strings: TemplateStringsArray, ...values: unknown[]): string;
//#endregion
//#region shared/parse-filter-function-path.d.ts
/**
 * Parse count(a.b.c) as a.b.count(c) and a.b.count(c.d) as a.b.c.count(d)
 */
declare function parseFilterFunctionPath(path: string): string;
//#endregion
//#region shared/parse-filter.d.ts
type ParseFilterContext = {
  $CURRENT_USER?: User & Record<string, any>;
  $CURRENT_ROLE?: Role & Record<string, any>;
  $CURRENT_ROLES?: (Role & Record<string, any>)[];
  $CURRENT_POLICIES?: (Policy & Record<string, any>)[];
};
type BasicAccountability = Pick<Accountability, 'user' | 'role' | 'roles'>;
declare function parseFilter(filter: Filter | null, accountability: BasicAccountability | null, context?: ParseFilterContext, skipCoercion?: boolean): Filter | null;
declare function parsePreset(preset: Record<string, any> | null, accountability: BasicAccountability | null, context: ParseFilterContext): any;
//#endregion
//#region shared/parse-json.d.ts
/**
 * Run JSON.parse, but ignore `__proto__` properties. This prevents prototype pollution attacks
 */
declare function parseJSON(input: string): any;
declare function noproto<T>(key: string, value: T): T | void;
//#endregion
//#region shared/pluralize.d.ts
declare function pluralize<T extends string>(str: T): Plural<T>;
declare function depluralize<T extends string>(str: Plural<T>): T;
//#endregion
//#region shared/process-chunk.d.ts
declare function processChunk<T = unknown>(arr: T[], size: number, callback: (chunk: T[]) => Promise<void>): Promise<void>;
//#endregion
//#region shared/to-array.d.ts
declare function toArray<T = any>(val: T | T[]): T[];
//#endregion
//#region shared/to-boolean.d.ts
/**
 * Convert environment variable to Boolean
 */
declare function toBoolean(value: any): boolean;
//#endregion
//#region shared/validate-payload.d.ts
/**
 * Validate the payload against the given filter rules
 *
 * @param {Filter} filter - The filter rules to check against
 * @param {Record<string, any>} payload - The payload to validate
 * @param {JoiOptions} [options] - Optional options to pass to Joi
 * @returns Array of errors
 */
declare function validatePayload(filter: Filter, payload: Record<string, any>, options?: JoiOptions): BaseJoi.ValidationError[];
//#endregion
//#region shared/sieve-functions.d.ts
declare function sieveFunctions(data: unknown): unknown;
//#endregion
export { Joi, JoiOptions, REDACTED_TEXT, StringSchema, abbreviateNumber, addFieldFlag, adjustDate, applyOptionsData, compress, decompress, deepMap, defaults, depluralize, functions, generateJoi, get, getCollectionType, getEndpoint, getFieldsFromTemplate, getFilterOperatorsForType, getFunctionsForType, getOutputTypeForFunction, getRedactedString, getRelation, getRelationType, getRelations, getSimpleHash, injectFunctionResults, isDynamicVariable, isIn, isObject, isTypeIn, isValidJSON, isVueComponent, mergeFilters, moveInArray, noproto, normalizePath, numberGenerator, oneLine, optionToObject, optionToString, parseFilter, parseFilterFunctionPath, parseJSON, parsePreset, pluralize, processChunk, sieveFunctions, toArray, toBoolean, validatePayload };