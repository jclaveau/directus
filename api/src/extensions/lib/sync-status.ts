import { exists } from 'fs-extra';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getRegistryRootPath } from './get-registry-root-path.js';

export enum SyncStatus {
	UNKNOWN = 'UNKNOWN',
	SYNCING = 'SYNCING',
	DONE = 'DONE',
}

/**
 * Retrieves the sync status from the `.status` file in the local extensions folder
 */
export const getSyncStatus = async () => {
	const statusFilePath = join(getRegistryRootPath(), '.status');

	if (await exists(statusFilePath)) {
		const status = await readFile(statusFilePath, 'utf8');
		return status;
	} else {
		return SyncStatus.UNKNOWN;
	}
};

export const setSyncStatus = async (status: SyncStatus) => {
	const statusFilePath = join(getRegistryRootPath(), '.status');
	await writeFile(statusFilePath, status);
};
