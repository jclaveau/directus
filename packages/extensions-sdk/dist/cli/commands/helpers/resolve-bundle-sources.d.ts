import type { ExtensionOptionsBundle } from '@directus/extensions';
/**
 * The entry files of a bundle declaring its entries in code: the sides its
 * manifest `source` names, else `src/app.ts` and `src/api.ts`, a side whose
 * file is missing not being built.
 */
export declare function resolveBundleSources(bundleName: string, bundleOptions: Pick<ExtensionOptionsBundle, 'entries' | 'source'>, root?: string): Promise<{
    app: string | null;
    api: string | null;
}>;
