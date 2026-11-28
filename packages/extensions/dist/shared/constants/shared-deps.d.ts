//#region src/shared/constants/shared-deps.d.ts
/**
 * Dependencies that we guarantee are available in the global scope of the app's bundle when app
 * extensions are used. These are virtually rewritten to use the existing bundled instances in the
 * global scope rather than local copies
 */
declare const APP_SHARED_DEPS: string[];
/**
 * Dependencies that we guarantee are available in the node_modules of the API when API extensions
 * are used. The `directus:*` extensions are virtual entrypoints available in the sandbox
 */
declare const API_SHARED_DEPS: string[];
//#endregion
export { API_SHARED_DEPS, APP_SHARED_DEPS };