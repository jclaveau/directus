import { readFileSync } from 'node:fs';
import { DEFAULTS } from '../constants/defaults.js';
import type { Env } from '../types/env.js';
import type { EnvSources, EnvValueSource } from '../types/env-sources.js';
import { getConfigPath } from '../utils/get-config-path.js';
import { getDefaultType } from '../utils/get-default-type.js';
import { isCoreEnvVarName } from '../utils/is-core-env-var-name.js';
import { isFileKey } from '../utils/is-file-key.js';
import { readConfigurationFromProcess } from '../utils/read-configuration-from-process.js';
import { removeFileSuffix } from '../utils/remove-file-suffix.js';
import { findEnvVarDeclaration } from '../utils/find-env-var-declaration.js';
import { cast } from './cast.js';
import { checkDeclaredEnvVarValue } from './check-declared-env-var-value.js';
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

/**
 * Each variable as it was set, before any cast: what an extension declaring it
 * casts from, rather than from what core guessed it to be.
 */
let rawEnvVarValues: Record<string, unknown> = {};

/** The values the env `createEnv` last built was cast from. */
export const readEnvVarRawValues = (): Record<string, unknown> => rawEnvVarValues;

export const createEnv = (): Env => {
	const baseConfiguration = readConfigurationFromProcess();
	const fileConfiguration = readConfigurationFromFile(getConfigPath());

	const rawConfiguration = { ...baseConfiguration, ...fileConfiguration };

	// `readConfigurationFromFile` answers null when there is no config file at all,
	// which is the common case — hence the keys, not an `in` over a nullable object.
	const fileKeys = new Set(Object.keys(fileConfiguration ?? {}));

	const output: Record<string, unknown> = {};
	const valueRefusals: string[] = [];

	sources = {};
	rawEnvVarValues = {};

	for (const [key, value] of Object.entries(DEFAULTS)) {
		output[key] = getDefaultType(key) ? cast(value, key) : value;
		sources[key] = 'default';
	}

	for (let [key, value] of Object.entries(rawConfiguration)) {
		let source: EnvValueSource = fileKeys.has(key)
			? 'file'
			: 'process';

		const isCoreFileEnvVarName = isFileKey(key)
			&& isCoreEnvVarName(removeFileSuffix(key));

		if (isCoreFileEnvVarName && typeof value === 'string') {
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

		const envVarDeclaration = findEnvVarDeclaration(key);

		let typedDeclaration = envVarDeclaration && 'type' in envVarDeclaration
			? envVarDeclaration
			: undefined;

		// A `boolean:` prefix on a name with no declared type is checked as one.
		if (!typedDeclaration && getCastFlag(value) === 'boolean') {
			typedDeclaration = { type: 'boolean' };
		}

		const valueRefusal = typedDeclaration
			&& checkDeclaredEnvVarValue(key, value, typedDeclaration);

		if (valueRefusal) {
			valueRefusals.push(valueRefusal);

			continue;
		}

		output[key] = cast(value, key);
		sources[key] = source;
		rawEnvVarValues[key] = value;
	}

	if (valueRefusals.length > 0) {
		throw new Error(valueRefusals.join('\n'));
	}

	return output as Env; // keys checked above, one by one
};
