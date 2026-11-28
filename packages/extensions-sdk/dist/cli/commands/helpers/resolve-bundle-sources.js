import fse from 'fs-extra';
import path from 'path';
const DEFAULT_SOURCES = { app: 'src/app.ts', api: 'src/api.ts' };
async function isSourceFile(root, source) {
    const sourcePath = path.resolve(root, source);
    return (await fse.pathExists(sourcePath)) && (await fse.stat(sourcePath)).isFile();
}
/**
 * The entry files of a bundle declaring its entries in code: the sides its
 * manifest `source` names, else `src/app.ts` and `src/api.ts`, a side whose
 * file is missing not being built.
 */
export async function resolveBundleSources(bundleName, bundleOptions, root = process.cwd()) {
    const resolvedSources = {
        app: null,
        api: null,
    };
    const declaredSource = bundleOptions.source;
    if (declaredSource !== undefined) {
        if (bundleOptions.entries !== undefined) {
            throw new Error(`Bundle ${JSON.stringify(bundleName)} declares both "entries" and "source"`);
        }
        for (const side of ['app', 'api']) {
            const sideSource = declaredSource[side];
            if (sideSource === undefined) {
                continue;
            }
            if (!(await isSourceFile(root, sideSource))) {
                throw new Error(`Bundle ${JSON.stringify(bundleName)} names ${JSON.stringify(sideSource)}`
                    + ` as its ${side} source, which is not a file`);
            }
            resolvedSources[side] = sideSource;
        }
        if (resolvedSources.app === null && resolvedSources.api === null) {
            throw new Error(`Bundle ${JSON.stringify(bundleName)} declares a "source" naming no side`);
        }
        return resolvedSources;
    }
    for (const side of ['app', 'api']) {
        if (await isSourceFile(root, DEFAULT_SOURCES[side])) {
            resolvedSources[side] = DEFAULT_SOURCES[side];
        }
    }
    if (resolvedSources.app === null && resolvedSources.api === null) {
        throw new Error(`Bundle ${JSON.stringify(bundleName)} has no "src/app.ts" or "src/api.ts"`);
    }
    return resolvedSources;
}
