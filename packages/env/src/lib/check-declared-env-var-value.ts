import { parseJSON } from '@directus/utils/values';
import type { EnvVarDeclaration } from '../types/env-var-declaration.js';
import { getCastFlag } from '../utils/has-cast-prefix.js';
import { toNumber } from '../utils/lodash-es-used.js';
import { castDeclaredEnvVarValue, stripCastFlag } from './cast.js';
import type { EnvVarDeclaredType } from '../types/env-type.js';

/** What a boolean is spelled as, in a variable or in a configuration file. */
const BOOLEAN_SPELLINGS: unknown[] = ['true', 'false', '1', '0', true, false, 1, 0];

/** The `type:` prefixes a value of each declared type may carry. */
const DECLARED_CAST_FLAGS: Record<EnvVarDeclaredType, readonly string[]> = {
	'string': ['string'],
	'number': ['number'],
	'regex': ['regex'],
	'string[]': ['array'],
	'json': ['json'],
	'boolean': ['boolean'],
	'false | number': ['number'],
	'false | string': ['string'],
	'false | string[]': ['array'],
	'boolean | number | string | string[]': [
		'boolean',
		'number',
		'string',
		'array',
	],
};

const isNumberValue = (bareValue: unknown): boolean => {
	return (typeof bareValue === 'number' || typeof bareValue === 'string')
		&& String(bareValue).trim() !== ''
		&& !Number.isNaN(toNumber(bareValue));
};

/**
 * Why a value, its cast prefix taken off, is not of `envVarDeclaration`'s type.
 */
const readTypeRefusal = (
	quotedName: string,
	bareValue: unknown,
	envVarDeclaration: EnvVarDeclaration,
): string | null => {
	const quotedValue = JSON.stringify(bareValue);

	switch (envVarDeclaration.type) {
		case 'number':
			return isNumberValue(bareValue)
				? null
				: `${quotedName} is ${quotedValue}, which is not a number.`;
		case 'false | number':
			return bareValue === false
				|| bareValue === 'false'
				|| isNumberValue(bareValue)
				? null
				: `${quotedName} is ${quotedValue}, which is neither false`
					+ ' nor a number.';
		case 'boolean':
			return BOOLEAN_SPELLINGS.includes(bareValue)
				? null
				: `${quotedName} is ${quotedValue}, which is not a boolean:`
					+ ' use true, false, 1 or 0.';

		case 'regex':
			try {
				new RegExp(String(bareValue));

				return null;
			}
			catch {
				return `${quotedName} is ${quotedValue}, which is not a regex.`;
			}

		case 'json':
			// The value is left out of the message: JSON may hold credentials.
			try {
				if (typeof bareValue === 'string') {
					parseJSON(bareValue);
				}

				return null;
			}
			catch {
				return `${quotedName} is not JSON.`;
			}

		default:
			return null;
	}
};

/**
 * Why `envVarValue`, as set for the variable `envVarName`, does not fit
 * `envVarDeclaration`, or null when it does: a cast prefix naming another
 * type, a value its type cannot read, or one outside the declared `values`.
 */
export const checkDeclaredEnvVarValue = (
	envVarName: string,
	envVarValue: unknown,
	envVarDeclaration: EnvVarDeclaration,
): string | null => {
	const quotedName = JSON.stringify(envVarName);
	const castFlag = getCastFlag(envVarValue);

	const declaredFlags = DECLARED_CAST_FLAGS[envVarDeclaration.type];

	if (castFlag !== null && !declaredFlags.includes(castFlag)) {
		return `${quotedName} is declared ${envVarDeclaration.type}, but its`
			+ ` ${JSON.stringify(`${castFlag}:`)} prefix casts it to ${castFlag}.`;
	}

	if (castFlag === 'number' && !isNumberValue(stripCastFlag(envVarValue))) {
		return `${quotedName} is ${JSON.stringify(envVarValue)},`
			+ ' which is not a number.';
	}

	const typeRefusal = readTypeRefusal(
		quotedName,
		stripCastFlag(envVarValue),
		envVarDeclaration,
	);

	if (typeRefusal !== null || envVarDeclaration.values === undefined) {
		return typeRefusal;
	}

	const castValue = castDeclaredEnvVarValue(envVarValue, envVarDeclaration);

	// as: includes takes only a string; any other value is simply not found
	if (envVarDeclaration.values.includes(castValue as string)) {
		return null;
	}

	const quotedChoices = envVarDeclaration.values
		.map((declaredChoice) => JSON.stringify(declaredChoice))
		.join(', ');

	return `${quotedName} is ${JSON.stringify(castValue)}, which is not one of`
		+ ` ${quotedChoices}.`;
};
