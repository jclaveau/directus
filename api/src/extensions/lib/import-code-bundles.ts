import {
	type BundleApiEntry,
	readBundleEntries,
} from '@directus/extensions/scalabus';
import type { Extension } from '@directus/types';
import fse from 'fs-extra';
import path from 'node:path';
import type { ExtensionMigration } from '../../database/migrations/list.js';
import getModuleDefault from '../../utils/get-module-default.js';
import { importFileUrl } from '../../utils/import-file-url.js';

export type ExtensionSource = 'module' | 'registry';

export interface CodeBundle {
	source: ExtensionSource;
	folder: string;
	name: string;
	apiPath: string;
	entries: BundleApiEntry[];
}

/**
 * Imports the `api.js` of every bundle declaring its entries in code, once, so
 * that its entries are known before the settings are synced. A bundle without
 * an `api.js` has no api side to import.
 */
export async function importCodeBundles(
	extensions: Record<ExtensionSource, Map<string, Extension>>,
	options: { fresh: boolean },
): Promise<{
	codeBundles: CodeBundle[];
	failures: { name: string; error: unknown }[];
}> {
	const codeBundles: CodeBundle[] = [];
	const failures: { name: string; error: unknown }[] = [];

	for (const source of ['module', 'registry'] as const) {
		for (const [folder, extension] of extensions[source]) {
			if (extension.type !== 'bundle' || extension.entriesFrom !== 'code') {
				continue;
			}

			const apiPath = path.resolve(extension.path, extension.entrypoint.api);

			if (!(await fse.pathExists(apiPath))) {
				continue;
			}

			try {
				const bundleModule = await importFileUrl(apiPath, import.meta.url, {
					fresh: options.fresh,
				});

				codeBundles.push({
					source,
					folder,
					name: extension.name,
					apiPath,
					entries: readBundleEntries(getModuleDefault(bundleModule)),
				});
			}
			catch (error) {
				failures.push({ name: extension.name, error });
			}
		}
	}

	return { codeBundles, failures };
}

export function listMigrationEntries(
	codeBundles: CodeBundle[],
): ExtensionMigration[] {
	return codeBundles.flatMap((codeBundle) => {
		return codeBundle.entries.flatMap((entry) => {
			return entry.type === 'migration'
				? [{ bundle: codeBundle.name, name: entry.name, config: entry.config }]
				: [];
		});
	});
}
