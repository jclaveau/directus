import { BundleApiEntry } from "./define-entry.js";

//#region src/scalabus/read-bundle-entries.d.ts

/**
 * The entries of a bundle's built `api.js`, whichever way it declares them:
 * `defineBundleApi([...])`, or the `{ hooks, endpoints, operations }` the
 * package.json `entries` build generates.
 */
declare function readBundleEntries(bundleModule: unknown): BundleApiEntry[];
//#endregion
export { readBundleEntries };