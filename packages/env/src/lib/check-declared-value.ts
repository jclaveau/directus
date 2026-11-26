import { parseJSON } from '@directus/utils/values';
import type { EnvDeclaration } from '../types/env-declaration.js';
import { getCastFlag } from '../utils/has-cast-prefix.js';
import { toNumber } from '../utils/lodash-es-used.js';
import { castDeclaredValue, stripCastFlag } from './cast.js';
import type { EnvDeclarationType } from '../types/env-type.js';

/** What a boolean is spelled as, in a variable or in a configuration file. */
const BOOLEAN_SPELLINGS: unknown[] = ['true', 'false', '1', '0', true, false, 1, 0];

/** The `type:` prefixes a value of each declared type may carry. */
const DECLARED_CAST_FLAGS: Record<EnvDeclarationType, readonly string[]> = {
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

/** Why `value`, its cast prefix taken off, is not of `envDeclaration`'s type. */
const readTypeRefusal = (
	quotedName: string,
	bareValue: unknown,
	envDeclaration: EnvDeclaration,
): string | null => {
	const quotedValue = JSON.stringify(bareValue);

	switch (envDeclaration.type) {
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
 * Why `value`, as set for the variable `name`, does not fit `envDeclaration`,
 * or null when it does: a cast prefix naming another type, a value its type
 * cannot read, or one outside the declared `values`.
 */
export const checkDeclaredValue = (
	name: string,
	value: unknown,
	envDeclaration: EnvDeclaration,
): string | null => {
	const quotedName = JSON.stringify(name);
	const castFlag = getCastFlag(value);

	const declaredFlags = DECLARED_CAST_FLAGS[envDeclaration.type];

	if (castFlag !== null && !declaredFlags.includes(castFlag)) {
		return `${quotedName} is declared ${envDeclaration.type}, but its`
			+ ` ${JSON.stringify(`${castFlag}:`)} prefix casts it to ${castFlag}.`;
	}

	const typeRefusal = readTypeRefusal(
		quotedName,
		stripCastFlag(value),
		envDeclaration,
	);

	if (typeRefusal !== null || envDeclaration.values === undefined) {
		return typeRefusal;
	}

	const castValue = castDeclaredValue(value, envDeclaration);

	// as: includes takes only a string; any other value is simply not found
	if (envDeclaration.values.includes(castValue as string)) {
		return null;
	}

	const quotedChoices = envDeclaration.values
		.map((choice) => JSON.stringify(choice))
		.join(', ');

	return `${quotedName} is ${JSON.stringify(castValue)}, which is not one of`
		+ ` ${quotedChoices}.`;
};
