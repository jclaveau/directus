import { DirectusError } from "../types/error.js";

//#region src/utils/is-directus-error.d.ts

/**
 * A type guard to check if an error is a Directus API error
 */
declare function isDirectusError<R = Response>(error: unknown): error is DirectusError<R>;
//#endregion
export { isDirectusError };
//# sourceMappingURL=is-directus-error.d.ts.map