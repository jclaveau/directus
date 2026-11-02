import { useEnv } from '@directus/env';

export const getExtensionsPath = () => {
	const env = useEnv();

	return env['EXTENSIONS_PATH'] as string;
};
