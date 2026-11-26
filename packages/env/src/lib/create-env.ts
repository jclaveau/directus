import { readFileSync } from 'node:fs';
import { DEFAULTS } from '../constants/defaults.js';
import type { Env } from '../types/env.js';
import type { EnvSources, EnvValueSource } from '../types/env-sources.js';
import { getConfigPath } from '../utils/get-config-path.js';
import { getDefaultType } from '../utils/get-default-type.js';
import { isDirectusVariable } from '../utils/is-directus-variable.js';
import { isFileKey } from '../utils/is-file-key.js';
import { readConfigurationFromProcess } from '../utils/read-configuration-from-process.js';
import { removeFileSuffix } from '../utils/remove-file-suffix.js';
import { cast } from './cast.js';
import { readConfigurationFromFile } from './read-configuration-from-file.js';
import { getCastFlag } from '../utils/has-cast-prefix.js';

/**
 * Which layer supplied each variable's final value, recorded as the layers are
 * applied. Knowing a value is worth little without knowing which layer won it —
 * reproducing the loader's inputs by hand to find out is exactly what the
 * processes report exists to spare.
 */
let sources: EnvSources = {};

/** The provenance of the env `createEnv` last built. */
export const readEnvSources = (): EnvSources => sources;

export const createEnv = (): Env => {
	const baseConfiguration = readConfigurationFromProcess();
	const fileConfiguration = readConfigurationFromFile(getConfigPath());

	const rawConfiguration = { ...baseConfiguration, ...fileConfiguration };

	// `readConfigurationFromFile` answers null when there is no config file at all,
	// which is the common case — hence the keys, not an `in` over a nullable object.
	const fileKeys = new Set(Object.keys(fileConfiguration ?? {}));

	const output: Env = {};

	sources = {};

	for (const [key, value] of Object.entries(DEFAULTS)) {
		output[key] = getDefaultType(key) ? cast(value, key) : value;
		sources[key] = 'default';
	}

	for (let [key, value] of Object.entries(rawConfiguration)) {
		let source: EnvValueSource = fileKeys.has(key)
			? 'file'
			: 'process';

		if (isFileKey(key) && isDirectusVariable(key) && typeof value === 'string') {
			try {
				// get the path to the file
				const castFlag = getCastFlag(value);
				const castPrefix = castFlag ? castFlag + ':' : '';
				const filePath = castFlag ? value.replace(castPrefix, '') : value;

				// read file content
				const fileContent = readFileSync(filePath, { encoding: 'utf8' });

				// override key value pair
				key = removeFileSuffix(key);
				value = castPrefix + fileContent;
				source = 'secret-file';
			} catch {
				throw new Error(`Failed to read value from file "${value}", defined in environment variable "${key}".`);
			}
		}

		output[key] = cast(value, key);
		sources[key] = source;
	}

	return output;
};
