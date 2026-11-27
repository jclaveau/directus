import type { Env } from '../types/env.js';
import type { EnvSources } from '../types/env-sources.js';
import {
	createEnv,
	readEnvVarRawValues,
	readEnvSources,
} from './create-env.js';

export const _cache: {
	env: Env | undefined;
} = { env: undefined } as const;

export const useEnv = () => {
	if (_cache.env) {
		return _cache.env;
	}

	_cache.env = createEnv();

	return _cache.env;
};

/**
 * Which layer each resolved variable's value came from. Reads off the same
 * memoized build as `useEnv`, so it always describes the env in force.
 */
export const useEnvSources = (): EnvSources => {
	useEnv();

	return readEnvSources();
};

/**
 * Each variable as it was set, before any cast, off the same build as
 * `useEnv`.
 */
export const useEnvVarRawValues = (): Record<string, unknown> => {
	useEnv();

	return readEnvVarRawValues();
};
