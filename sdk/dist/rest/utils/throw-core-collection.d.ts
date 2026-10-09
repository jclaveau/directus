//#region src/rest/utils/throw-core-collection.d.ts
/**
 *
 * @param value
 * @param message
 * @throws Throws an error if the collection starts with the `directus_` prefix
 */
declare const throwIfCoreCollection: (value: string | number | symbol, message: string) => void;
//#endregion
export { throwIfCoreCollection };
//# sourceMappingURL=throw-core-collection.d.ts.map