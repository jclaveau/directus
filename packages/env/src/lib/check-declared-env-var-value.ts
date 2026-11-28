import { parseJSON } from '@directus/utils/values';
import type { EnvVarDeclaration } from '../types/env-var-declaration.js';
import { getCastFlag } from '../utils/has-cast-prefix.js';
import { toNumber } from '../utils/lodash-es-used.js';
import { castEnvVarValue, stripCastFlag } from './cast.js';
import type { EnvVarDeclaredType } from '../types/env-type.js';

/** What a boolean is spelled as, in a variable or in a configuration file. */
const BOOLEAN_SPELLINGS: unknown[] = ['true', 'false', '1', '0', true, false, 1, 0];

/** A string boolean as `toBoolean` reads it: in any case, spaces around it. */
const readBooleanCase = (bareValue: unknown): unknown => {
	return typeof bareValue === 'string'
		? bareValue.trim().toLowerCase()
		: bareValue;
};

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
	'null | string[]': ['array'],
	'number | string': ['number', 'string'],
	'boolean | number | string | string[]': [
		'boolean',
		'number',
		'string',
		'array',
	],
};

/**
 * The names whose value may be a credential: a refusal leaves their value out,
 * as the json one does for every name.
 */
const SECRET_ENV_VAR_NAME_PATTERN =
	/PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|SALT|PRIVATE/;

/**
 * `"NAME" is "value", which is <expected>.`, the value left out for a name
 * that may hold a credential.
 */
const describeValueRefusal = (
	quotedName: string,
	refusedValue: unknown,
	expectedShape: string,
): string => {
	return SECRET_ENV_VAR_NAME_PATTERN.test(quotedName)
		? `${quotedName} is ${expectedShape}.`
		: `${quotedName} is ${JSON.stringify(refusedValue)},`
			+ ` which is ${expectedShape}.`;
};

/** A config file's number or boolean reads as its string, an object does not. */
const isScalarValue = (bareValue: unknown): boolean => {
	return ['string', 'number', 'boolean'].includes(typeof bareValue);
};

const isScalarListValue = (bareValue: unknown): boolean => {
	return Array.isArray(bareValue) && bareValue.every(isScalarValue);
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
	const describeShapeRefusal = (expectedShape: string): string => {
		return describeValueRefusal(quotedName, bareValue, expectedShape);
	};

	switch (envVarDeclaration.type) {
		case 'number':
			return isNumberValue(bareValue)
				? null
				: describeShapeRefusal('not a number');
		case 'false | number':
			return bareValue === false
				|| bareValue === 'false'
				|| isNumberValue(bareValue)
				? null
				: describeShapeRefusal('neither false nor a number');
		case 'boolean':
			return BOOLEAN_SPELLINGS.includes(readBooleanCase(bareValue))
				? null
				: describeValueRefusal(
					`${quotedName} Environment Variable`,
					bareValue,
					'not a boolean. Use one of true, false, 1, 0',
				);

		case 'regex':
			try {
				new RegExp(String(bareValue));

				return null;
			}
			catch {
				return describeShapeRefusal('not a regex');
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

		case 'string':
			return isScalarValue(bareValue)
				? null
				: describeShapeRefusal('not a string');
		case 'false | string':
			return isScalarValue(bareValue)
				? null
				: describeShapeRefusal('neither false nor a string');
		case 'string[]':
			return isScalarValue(bareValue) || isScalarListValue(bareValue)
				? null
				: describeShapeRefusal('neither a string nor a list of strings');
		case 'null | string[]':
			return isScalarValue(bareValue) || isScalarListValue(bareValue)
				|| bareValue === null
				? null
				: describeShapeRefusal(
					'neither null, a string nor a list of strings',
				);
		case 'number | string':
			return (typeof bareValue === 'number'
				|| typeof bareValue === 'string')
				&& !['true', 'false'].includes(String(readBooleanCase(bareValue)))
				? null
				: describeShapeRefusal(
					'neither a number of seconds nor a duration',
				);
		case 'false | string[]':
			return isScalarValue(bareValue) || isScalarListValue(bareValue)
				? null
				: describeShapeRefusal(
					'neither false, a string nor a list of strings',
				);

		case 'boolean | number | string | string[]':
			return isScalarValue(bareValue) || isScalarListValue(bareValue)
				? null
				: describeShapeRefusal(
					'neither a boolean, a number, a string nor a list of strings',
				);
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
		return describeValueRefusal(quotedName, envVarValue, 'not a number');
	}

	const typeRefusal = readTypeRefusal(
		quotedName,
		stripCastFlag(envVarValue),
		envVarDeclaration,
	);

	if (typeRefusal !== null || envVarDeclaration.values === undefined) {
		return typeRefusal;
	}

	const castValue = castEnvVarValue(envVarValue, envVarDeclaration.type);

	// as: includes takes only a string; any other value is simply not found
	if (envVarDeclaration.values.includes(castValue as string)) {
		return null;
	}

	const quotedChoices = envVarDeclaration.values
		.map((declaredChoice) => JSON.stringify(declaredChoice))
		.join(', ');

	return describeValueRefusal(
		quotedName,
		castValue,
		`not one of ${quotedChoices}`,
	);
};
