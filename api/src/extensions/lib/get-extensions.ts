import { useEnv } from '@directus/env';
import { resolveModuleExtensions } from '@directus/extensions/node';

export const getExtensions = async () => {
	const env = useEnv();

	/** Extensions that are listed as dependencies in the root package.json */
	const moduleExtensions = await resolveModuleExtensions(env['PACKAGE_FILE_LOCATION'] as string);

	return { module: moduleExtensions };
};
