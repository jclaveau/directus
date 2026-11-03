import fse from 'fs-extra';
import path from 'path';

const DEFAULT_APP_SOURCE = 'src/app.ts';
const DEFAULT_API_SOURCE = 'src/api.ts';

async function isSourceFile(root: string, source: string): Promise<boolean> {
	const sourcePath = path.resolve(root, source);

	return (await fse.pathExists(sourcePath)) && (await fse.stat(sourcePath)).isFile();
}

/**
 * The entry files of a bundle declaring its entries in code. A side whose
 * default file is missing is not built; a side `source` names must exist.
 */
export async function resolveBundleSources(
	bundleName: string,
	declaredSource:
		| { app?: string | undefined; api?: string | undefined }
		| undefined,
	root: string = process.cwd(),
): Promise<{ app: string | null; api: string | null }> {
	const resolvedSources: { app: string | null; api: string | null } = {
		app: null,
		api: null,
	};

	for (const side of ['app', 'api'] as const) {
		const declaredFile = declaredSource?.[side];

		if (declaredFile !== undefined) {
			if (!(await isSourceFile(root, declaredFile))) {
				throw new Error(
					`Bundle ${JSON.stringify(bundleName)} sets "source.${side}" to`
						+ ` ${JSON.stringify(declaredFile)}, which does not exist`,
				);
			}

			resolvedSources[side] = declaredFile;
			continue;
		}

		const defaultFile = side === 'app'
			? DEFAULT_APP_SOURCE
			: DEFAULT_API_SOURCE;

		if (await isSourceFile(root, defaultFile)) {
			resolvedSources[side] = defaultFile;
		}
	}

	if (resolvedSources.app === null && resolvedSources.api === null) {
		throw new Error(
			`Bundle ${JSON.stringify(bundleName)} has no "src/app.ts" or "src/api.ts";`
				+ ` set "source" to point at its entry files`,
		);
	}

	return resolvedSources;
}
