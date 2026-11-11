import { importCodeBundles, listMigrationEntries } from "./import-code-bundles.js";
import { getExtensions } from "./get-extensions.js";

//#region src/extensions/lib/get-extension-migrations.ts
/**
* The `defineMigration`s of the installed bundles, for a CLI command that
* migrates without loading the extensions. A bundle failing to import fails
* the command: its migrations would otherwise be skipped silently.
*/
async function getExtensionMigrations() {
	const { codeBundles, failures } = await importCodeBundles(await getExtensions(), { fresh: false });
	const [failure] = failures;
	if (failure) throw new Error(`Couldn't import bundle ${JSON.stringify(failure.name)}`, { cause: failure.error });
	return listMigrationEntries(codeBundles);
}

//#endregion
export { getExtensionMigrations };