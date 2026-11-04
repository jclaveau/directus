import type { AppChunkStamp } from '@/utils/sync-app-chunk';
import type { ApiOutput } from '@directus/types';

/**
 * The entries a bundle lists in the settings. A bundle declaring its entries in
 * code has rows for its api entries only, and for the app entries an admin
 * toggled: the app chunk declares the others.
 */
export function listBundleChildren(
	bundle: ApiOutput,
	extensions: ApiOutput[],
	codeBundleEntries: NonNullable<AppChunkStamp['bundleEntries']>,
): ApiOutput[] {
	const entryRows = extensions.filter((row) => row.bundle === bundle.id);

	if (bundle.schema?.type !== 'bundle' || bundle.schema.entriesFrom !== 'code') {
		return entryRows;
	}

	const apiRows = entryRows.filter((row) => row.schema !== null);

	const chunkBundle = codeBundleEntries.find((codeBundle) => {
		return codeBundle.source === bundle.meta.source
			&& codeBundle.folder === bundle.meta.folder;
	});

	const appRows = (chunkBundle?.entries ?? []).flatMap((entry) => {
		if (apiRows.some((row) => row.meta.folder === entry.name)) {
			return [];
		}

		const overrideRow = entryRows.find((row) => row.meta.folder === entry.name);

		if (overrideRow) {
			return [{ ...overrideRow, schema: entry }];
		}

		const entryId = `${bundle.id}/${entry.name}`;

		return [
			{
				id: entryId,
				bundle: bundle.id,
				schema: entry,
				meta: {
					id: entryId,
					enabled: bundle.meta.enabled,
					source: bundle.meta.source,
					bundle: bundle.id,
					folder: entry.name,
				},
			},
		];
	});

	return [...apiRows, ...appRows] as ApiOutput[];
}
