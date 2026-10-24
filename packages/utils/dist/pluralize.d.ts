import { Plural } from "@directus/types";

//#region shared/pluralize.d.ts
declare function pluralize<T extends string>(str: T): Plural<T>;
declare function depluralize<T extends string>(str: Plural<T>): T;
//#endregion
export { depluralize, pluralize };