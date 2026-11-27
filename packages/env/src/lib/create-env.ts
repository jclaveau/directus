import { toArray } from '@directus/utils/values';
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
import { castEnvVarValue, stripCastFlag } from './cast.js';
import { checkDeclaredEnvVarValue } from './check-declared-env-var-value.js';
import { readConfigurationFromFile } from './read-configuration-from-file.js';
import { readEnvVarFile } from './read-env-var-file.js';
import { getCastFlag } from '../utils/has-cast-prefix.js';

/** The prefixes whose value may not fit them: `number:abc` refuses the boot. */
const CHECKED_CAST_FLAGS = ['number', 'boolean', 'regex', 'json'] as const;

/**
 * Why a value set on a name with no declared type does not fit its prefix,
 * or that of one of its `array:` items, or null when it does.
 */
const readUndeclaredPrefixRefusal = (
	envVarName: string,
	envVarValue: unknown,
): string | null => {
	const castFlag = getCastFlag(envVarValue);

	if (castFlag === 'array') {
		const itemRefusals = toArray(stripCastFlag(envVarValue))
			.map((listItem) => readUndeclaredPrefixRefusal(envVarName, listItem));

		return itemRefusals.find((itemRefusal) => itemRefusal !== null) ?? null;
	}

	const checkedCastFlag = CHECKED_CAST_FLAGS
		.find((checkedFlag) => checkedFlag === castFlag);

	return checkedCastFlag
		? checkDeclaredEnvVarValue(envVarName, envVarValue, {
			type: checkedCastFlag,
		})
		: null;
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
		const defaultType = getDefaultType(key);

		output[key] = defaultType
			? castEnvVarValue(value, defaultType)
			: value;

		sources[key] = 'default';
	}

	for (let [key, value] of Object.entries(rawConfiguration)) {
		let source: EnvValueSource = fileKeys.has(key)
			? 'file'
			: 'process';

		const isCoreFileEnvVarName = isFileKey(key)
			&& isCoreEnvVarName(removeFileSuffix(key));

		if (isCoreFileEnvVarName && typeof value === 'string') {
			value = readEnvVarFile(
				key,
				value,
				getDefaultType(removeFileSuffix(key)),
			);

			key = removeFileSuffix(key);
			source = 'secret-file';
		}

		const envVarDeclaration = findEnvVarDeclaration(key);

		const typedDeclaration = envVarDeclaration && 'type' in envVarDeclaration
			? envVarDeclaration
			: undefined;

		const valueRefusal = typedDeclaration
			? checkDeclaredEnvVarValue(key, value, typedDeclaration)
			: readUndeclaredPrefixRefusal(key, value);

		if (valueRefusal) {
			valueRefusals.push(valueRefusal);

			continue;
		}

		output[key] = castEnvVarValue(value, getDefaultType(key));
		sources[key] = source;
		rawEnvVarValues[key] = value;
	}

	if (valueRefusals.length > 0) {
		throw new Error(valueRefusals.join('\n'));
	}

	return output as Env; // keys checked above, one by one
};
