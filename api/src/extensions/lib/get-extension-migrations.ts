import type { ExtensionMigration } from '../../database/migrations/list.js';
import { getExtensions } from './get-extensions.js';
import { importCodeBundles, listMigrationEntries } from './import-code-bundles.js';

/**
 * The `defineMigration`s of the installed bundles, for a CLI command that
 * migrates without loading the extensions. A bundle failing to import fails
 * the command: its migrations would otherwise be skipped silently.
 */
export async function getExtensionMigrations(): Promise<ExtensionMigration[]> {
	const { codeBundles, failures } = await importCodeBundles(await getExtensions(), {
		fresh: false,
	});

	const [failure] = failures;

	if (failure) {
		throw new Error(`Couldn't import bundle ${JSON.stringify(failure.name)}`, {
			cause: failure.error,
		});
	}

	return listMigrationEntries(codeBundles);
}
