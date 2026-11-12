import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The extensions every purge bench boots with. */
export const PURGE_EXTENSION_FOLDERS = [
	'perf-cache-fill',
	'perf-declared-purge',
	'perf-index-walk',
	'perf-pending-retry',
].map((extensionName) => {
	return fileURLToPath(
		new URL(`./purge-extensions/${extensionName}`, import.meta.url),
	);
});

/**
 * A temporary directory holding a package.json whose dependencies are the
 * extensions in `extensionFolders`, each symlinked under `node_modules` by its
 * folder name, for an instance pointed at it by PACKAGE_FILE_LOCATION. With no
 * folder given, that instance loads no extension.
 */
export async function createExtensionPackage(
	extensionFolders: string[] = [],
): Promise<string> {
	const packagePath = await mkdtemp(
		join(tmpdir(), 'directus-perf-extensions-'),
	);

	const packageNames = extensionFolders.map((extensionFolder) => {
		return basename(extensionFolder);
	});

	await writeFile(
		join(packagePath, 'package.json'),
		JSON.stringify({
			name: 'perf-instance',
			private: true,
			dependencies: Object.fromEntries(
				packageNames.map((packageName) => [packageName, '*']),
			),
		}),
	);

	await mkdir(join(packagePath, 'node_modules'));

	for (const extensionFolder of extensionFolders) {
		await symlink(
			extensionFolder,
			join(packagePath, 'node_modules', basename(extensionFolder)),
		);
	}

	return packagePath;
}
