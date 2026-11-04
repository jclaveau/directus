import type { ExtensionOptionsBundle } from '@directus/extensions';
import fse from 'fs-extra';
import path from 'path';

const DEFAULT_SOURCES = { app: 'src/app.ts', api: 'src/api.ts' } as const;

async function isSourceFile(root: string, source: string): Promise<boolean> {
	const sourcePath = path.resolve(root, source);

	return (await fse.pathExists(sourcePath)) && (await fse.stat(sourcePath)).isFile();
}

/**
 * The entry files of a bundle declaring its entries in code: `src/app.ts` and
 * `src/api.ts`, a side whose file is missing not being built.
 */
export async function resolveBundleSources(
	bundleName: string,
	_bundleOptions: Pick<ExtensionOptionsBundle, 'entries' | 'source'>,
	root: string = process.cwd(),
): Promise<{ app: string | null; api: string | null }> {
	const resolvedSources: { app: string | null; api: string | null } = {
		app: null,
		api: null,
	};

	for (const side of ['app', 'api'] as const) {
		if (await isSourceFile(root, DEFAULT_SOURCES[side])) {
			resolvedSources[side] = DEFAULT_SOURCES[side];
		}
	}

	if (resolvedSources.app === null && resolvedSources.api === null) {
		throw new Error(
			`Bundle ${JSON.stringify(bundleName)} has no "src/app.ts" or "src/api.ts"`,
		);
	}

	return resolvedSources;
}
