import { useEnv } from '@directus/env';
import { resolveFsExtensions, resolveModuleExtensions } from '@directus/extensions/node';
import { getExtensionsPath } from './get-extensions-path.js';

export const getExtensions = async () => {
	const env = useEnv();

	const localExtensions = await resolveFsExtensions(getExtensionsPath());

	/** Extensions that are listed as dependencies in the root package.json */
	const moduleExtensions = await resolveModuleExtensions(env['PACKAGE_FILE_LOCATION'] as string);

	return { local: localExtensions, module: moduleExtensions };
};
