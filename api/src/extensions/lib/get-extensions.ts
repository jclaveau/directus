import { useEnv } from '@directus/env';
import { resolveFsExtensions, resolveModuleExtensions } from '@directus/extensions/node';
import { join } from 'node:path';
import { getRegistryRootPath } from './get-registry-root-path.js';

export const getExtensions = async () => {
	const env = useEnv();

	const registryExtensions = await resolveFsExtensions(
		join(getRegistryRootPath(), '.registry'),
	);

	/** Extensions that are listed as dependencies in the root package.json */
	const moduleExtensions = await resolveModuleExtensions(env['PACKAGE_FILE_LOCATION'] as string);

	return { registry: registryExtensions, module: moduleExtensions };
};
