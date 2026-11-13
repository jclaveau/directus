import { useEnv } from '@directus/env';
import { join } from 'node:path';

/**
 * The folder holding the Marketplace's `.registry` and the sync `.status`, and
 * its prefix in the EXTENSIONS_LOCATION storage.
 */
export const REGISTRY_STORAGE_ROOT = './extensions';

export const getRegistryRootPath = () => {
	const env = useEnv();

	if (env['EXTENSIONS_LOCATION']) {
		return join(env['TEMP_PATH'] as string, 'extensions');
	}

	return REGISTRY_STORAGE_ROOT;
};
