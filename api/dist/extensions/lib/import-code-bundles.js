import getModuleDefault from "../../utils/get-module-default.js";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fse from "fs-extra";
import { readBundleEntries } from "@directus/extensions/scalabus";

//#region src/extensions/lib/import-code-bundles.ts
/**
* Imports the `api.js` of every bundle declaring its entries in code, once, so
* that its entries are known before the settings are synced. A bundle without
* an `api.js` has no api side to import.
*/
async function importCodeBundles(extensions, options) {
	const codeBundles = [];
	const failures = [];
	for (const source of ["module", "registry"]) for (const [folder, extension] of extensions[source]) {
		if (extension.type !== "bundle" || extension.entriesFrom !== "code") continue;
		const apiPath = path.resolve(extension.path, extension.entrypoint.api);
		if (!await fse.pathExists(apiPath)) continue;
		try {
			const bundleUrl = pathToFileURL(apiPath).href;
			const bundleModule = await (options.fresh ? import(`${bundleUrl}?t=${Date.now()}`) : import(bundleUrl));
			codeBundles.push({
				source,
				folder,
				name: extension.name,
				apiPath,
				entries: readBundleEntries(getModuleDefault(bundleModule))
			});
		} catch (error) {
			failures.push({
				name: extension.name,
				error
			});
		}
	}
	return {
		codeBundles,
		failures
	};
}
function listMigrationEntries(codeBundles) {
	return codeBundles.flatMap((codeBundle) => {
		return codeBundle.entries.flatMap((entry) => {
			return entry.type === "migration" ? [{
				bundle: codeBundle.name,
				name: entry.name,
				config: entry.config
			}] : [];
		});
	});
}

//#endregion
export { importCodeBundles, listMigrationEntries };