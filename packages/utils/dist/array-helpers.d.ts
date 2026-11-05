//#region shared/array-helpers.d.ts
declare function isIn<T extends readonly string[]>(value: string, array: T): value is T[number];
declare function isTypeIn<T extends {
  type?: string;
}, E extends string>(object: T, array: readonly E[]): object is Extract<T, {
  type?: E;
}>;
//#endregion
export { isIn, isTypeIn };