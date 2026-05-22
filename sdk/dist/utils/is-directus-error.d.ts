import { DirectusError } from "../types/error.js";

//#region src/utils/is-directus-error.d.ts

/**
* A type guard to check if an error is a Directus API error
*/
declare function isDirectusError(error: unknown): error is DirectusError;
//#endregion
export { isDirectusError };
//# sourceMappingURL=is-directus-error.d.ts.map