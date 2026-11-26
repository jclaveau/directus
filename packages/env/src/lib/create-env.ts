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
 * What `toBoolean` reads as a boolean, spelled the ways an environment spells
 * one.
 */
const BOOLEANS = ['true', 'false', '1', '0'];

/**
 * Refuse a variable cast to boolean that is not one, whichever layer supplied
 * it.
 *
 * `toBoolean` reads anything outside {@link BOOLEANS} as `false`, so a
 * deployment that meant `TRUE` turns a feature off and says nothing. Checked
 * here, on the raw value, because once cast a typo and a deliberate `false` are
 * the same value. Thrown while the env is built, which is at import, so the
 * process ends before it listens.
 */
const refuseNonBoolean = (key: string, value: unknown): void => {
	const castFlag = getCastFlag(value);

	if ((castFlag ?? getDefaultType(key)) !== 'boolean') {
		return;
	}

	const rawValue = typeof value === 'string' && castFlag
		? value.substring(castFlag.length + 1)
		: value;

	if (BOOLEANS.includes(String(rawValue))) {
		return;
	}

	throw new Error(
		`${JSON.stringify(key)} Environment Variable is ${JSON.stringify(rawValue)}, `
			+ `which is not a boolean. Use one of ${BOOLEANS.join(', ')}.`,
	);
};

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

				const declaredType = castFlag ?? getDefaultType(key);

				// A secret is written with a trailing newline, which no boolean or
				// number parses with; a string, a password, keeps its exact bytes.
				value = castPrefix + (declaredType && declaredType !== 'string'
					? fileContent.trim()
					: fileContent);

				source = 'secret-file';
			} catch {
				throw new Error(`Failed to read value from file "${value}", defined in environment variable "${key}".`);
			}
		}

		refuseNonBoolean(key, value);

		output[key] = cast(value, key);
		sources[key] = source;
	}

	return output;
};
