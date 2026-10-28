import { ClientFilterOperator, CreateEntries, FieldFunction, PrimaryKey, Relation, Type, UnknownObject, UpdateEntries } from "@directus/types";

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
//#region shared/map-create-rows.d.ts
type MappedCreateRow<Item> = Partial<Item> | PrimaryKey | null | void;
/**
 * Map the rows of an `items.create` filter's entries one at a time, for a hook
 * that handles a single row. The mapping returns the row to insert, the key of a
 * stored row that answers it instead, or null to cancel it; returning nothing
 * keeps the copy it was handed, edits included. A row an earlier
 * hook already answered is left as it was, and a create an earlier hook
 * cancelled whole (null) stays cancelled.
 *
 * A payload that is no list of rows, such as the field a `fields.create` filter
 * carries to a hook registered on several events, comes back unchanged.
 */
declare function mapCreateRows<Item = any>(entries: CreateEntries<Item> | null, mapRow: (data: Partial<Item>, index: number) => MappedCreateRow<Item> | Promise<MappedCreateRow<Item>>): Promise<CreateEntries<Item> | null>;
//#endregion
//#region shared/map-update-rows.d.ts
type MappedUpdateRow<Item> = Partial<Item> | PrimaryKey | null | void;
/**
 * Map the rows of an `items.update` filter's groups one at a time, for a hook
 * that handles a single row. The mapping returns the change to write, the
 * row's key when the hook wrote the row itself, or null to cancel it; returning
 * nothing keeps the copy it was handed, edits included. A row an
 * earlier hook already took over is left as it was, and an update an earlier
 * hook cancelled whole (null) stays cancelled.
 *
 * The rows of one group that come back equal stay one group: the caller sent
 * them as one change, so they still write as one statement, and a nested item
 * the change creates is created once. Two groups never merge.
 *
 * A row mapped to a key is taken over under that key, whichever row it names:
 * the service judges it. A payload that is no list of groups, such as the change
 * a `fields.update` filter carries to a hook registered on several events, comes
 * back unchanged.
 */
declare function mapUpdateRows<Item = any>(entries: UpdateEntries<Item> | null, mapRow: (data: Partial<Item>, key: PrimaryKey) => MappedUpdateRow<Item> | Promise<MappedUpdateRow<Item>>): Promise<UpdateEntries<Item> | null>;
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
export { REDACTED_TEXT, compress, decompress, getFilterOperatorsForType, getFunctionsForType, getOutputTypeForFunction, getRedactedString, getRelation, getSimpleHash, isIn, isObject, isTypeIn, mapCreateRows, mapUpdateRows, noproto, parseJSON, toArray, toBoolean };