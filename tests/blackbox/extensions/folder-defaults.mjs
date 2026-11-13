import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The default export of each folder's `index.mjs` under `parentUrl`, in folder
 * name order. A folder without one is refused rather than skipped, so a fixture
 * that fails to load fails the bundle instead of its tests' setup.
 */
export async function importFolderDefaults(parentUrl) {
	const parentPath = fileURLToPath(parentUrl);
	const folderNames = (await readdir(parentPath)).sort();

	return Promise.all(folderNames.map(async (folderName) => {
		const indexPath = join(parentPath, folderName, 'index.mjs');

		if (!existsSync(indexPath)) {
			const folderPath = join(parentPath, folderName);
			throw new Error(`${JSON.stringify(folderPath)} holds no index.mjs.`);
		}

		const { default: folderDefault } = await import(
			pathToFileURL(indexPath).href
		);

		return { folderName, folderDefault };
	}));
}
