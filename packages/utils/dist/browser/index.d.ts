//#region browser/css-var.d.ts
/**
 * Get the value of a globally registered CSS variable
 */
declare function cssVar(name: string, element?: Element): string;
//#endregion
export { cssVar };