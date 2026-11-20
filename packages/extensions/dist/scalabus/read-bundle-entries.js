import { BUNDLE_ENTRIES_FORMAT, defineBundleApi, defineMigration } from "./define-entry.js";

//#region src/scalabus/read-bundle-entries.ts
const API_ENTRY_TYPES = [
	"hook",
	"endpoint",
	"operation",
	"migration"
];
function readDeclaredEntries(declaredEntries) {
	if (!Array.isArray(declaredEntries)) throw new Error(`Bundle module declares ${JSON.stringify(BUNDLE_ENTRIES_FORMAT)} without an "entries" array`);
	for (const [index, entry] of declaredEntries.entries()) {
		if (!API_ENTRY_TYPES.includes(entry?.type)) throw new Error(`Bundle entry ${index} declares an unknown type ${JSON.stringify(entry?.type)}; expected "hook", "endpoint", "operation" or "migration"`);
		if (entry.type === "migration") defineMigration(entry.name, entry.config);
	}
	return defineBundleApi(declaredEntries).entries;
}
/**
* The entries of a bundle's built `api.js`, whichever way it declares them:
* `defineBundleApi([...])`, or the `{ hooks, endpoints, operations }` the
* package.json `entries` build generates.
*/
function readBundleEntries(bundleModule) {
	if (typeof bundleModule !== "object" || bundleModule === null) throw new Error(`Bundle module exports ${JSON.stringify(typeof bundleModule)} instead of its entries`);
	if ("format" in bundleModule) {
		if (bundleModule.format !== BUNDLE_ENTRIES_FORMAT) throw new Error(`Bundle module declares an unknown format ${JSON.stringify(bundleModule.format)}; expected ${JSON.stringify(BUNDLE_ENTRIES_FORMAT)}`);
		return readDeclaredEntries(bundleModule.entries);
	}
	if ("hooks" in bundleModule && "endpoints" in bundleModule && "operations" in bundleModule) {
		const legacyModule = bundleModule;
		return [
			...legacyModule.hooks.map(({ name, config }) => {
				return {
					type: "hook",
					name,
					config
				};
			}),
			...legacyModule.endpoints.map(({ name, config }) => {
				return {
					type: "endpoint",
					name,
					config
				};
			}),
			...legacyModule.operations.map(({ name, config }) => {
				return {
					type: "operation",
					name,
					config
				};
			})
		];
	}
	throw new Error(`Bundle module exports neither ${JSON.stringify(BUNDLE_ENTRIES_FORMAT)} entries nor "hooks", "endpoints" and "operations"`);
}

//#endregion
export { readBundleEntries };