import { ClientFilterOperator, FieldFunction, Relation, Type, UnknownObject } from "@directus/types";

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
//#region shared/get-relation.d.ts
declare function getRelation(relations: Relation[], collection: string, field: string): Relation | undefined;
//#endregion
//#region shared/get-simple-hash.d.ts
/**
 * Generate a simple short hash for a given string
 * This is not cryptographically secure in any way, and has a high chance of collision
 */
declare function getSimpleHash(str: string): string;
//#endregion
//#region shared/is-object.d.ts
declare function isObject(input: unknown): input is UnknownObject;
//#endregion
//#region shared/parse-json.d.ts
/**
 * Run JSON.parse, but ignore `__proto__` properties. This prevents prototype pollution attacks
 */
declare function parseJSON(input: string): any;
declare function noproto<T>(key: string, value: T): T | void;
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
export { REDACTED_TEXT, compress, decompress, getFilterOperatorsForType, getFunctionsForType, getOutputTypeForFunction, getRedactedString, getRelation, getSimpleHash, isIn, isObject, isTypeIn, noproto, parseJSON, toArray, toBoolean };