import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Writes into `directory` a package.json whose dependencies are the extensions
 * of `extensionFolders` (package name to its folder), each symlinked under
 * `node_modules`, for an instance pointed at it by PACKAGE_FILE_LOCATION. With
 * no extension given, that instance loads none.
 */
export async function writeExtensionPackage(
	directory: string,
	extensionFolders: Record<string, string> = {},
): Promise<void> {
	await writeFile(
		join(directory, 'package.json'),
		JSON.stringify({
			name: 'blackbox-instance',
			private: true,
			dependencies: Object.fromEntries(
				Object.keys(extensionFolders).map((packageName) => {
					return [packageName, '*'];
				}),
			),
		}),
	);

	await mkdir(join(directory, 'node_modules'), { recursive: true });

	for (const [packageName, extensionFolder] of Object.entries(extensionFolders)) {
		await symlink(extensionFolder, join(directory, 'node_modules', packageName));
	}
}
