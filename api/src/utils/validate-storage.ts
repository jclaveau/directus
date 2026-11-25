import { useEnv } from '@directus/env';
import { toArray } from '@directus/utils';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { useLogger } from '../logger/index.js';

export async function validateStorage(): Promise<void> {
	const env = useEnv();
	const logger = useLogger();

	if (env['DB_CLIENT'] === 'sqlite3') { // bb-out-of-scope: #610 SQLite
		try {
			await access(path.dirname(env['DB_FILENAME'] as string), constants.R_OK | constants.W_OK);
		} catch {
			logger.warn(
				`Directory for SQLite database file (${path.resolve(
					path.dirname(env['DB_FILENAME'] as string),
				)}) is not read/writeable!`,
			);
		}
	}

	const usedStorageDrivers = toArray(env['STORAGE_LOCATIONS']).map(
		(location) => env[`STORAGE_${location.toUpperCase()}_DRIVER` as const],
	);

	if (usedStorageDrivers.includes('local')) {
		try {
			await access(env['STORAGE_LOCAL_ROOT'], constants.R_OK | constants.W_OK);
		} catch {
			const uploadDirectory = path.resolve(env['STORAGE_LOCAL_ROOT']);

			logger.warn(
				`Upload directory (${uploadDirectory}) is not read/writeable!`,
			);
		}
	}
}
