import { parseJSON } from '@directus/utils/values';
import type { EnvDeclaration } from '../types/env-declaration.js';
import { getCastFlag } from '../utils/has-cast-prefix.js';
import { toNumber } from '../utils/lodash-es-used.js';
import { castDeclaredValue, stripCastFlag } from './cast.js';

/** What a boolean is spelled as, in a variable or in a configuration file. */
const BOOLEAN_SPELLINGS: unknown[] = ['true', 'false', '1', '0', true, false, 1, 0];

/** Why `value`, its cast prefix taken off, is not of `envDeclaration`'s type. */
const readTypeRefusal = (
	quotedName: string,
	bareValue: unknown,
	envDeclaration: EnvDeclaration,
): string | null => {
	const quotedValue = JSON.stringify(bareValue);

	switch (envDeclaration.type) {
		case 'number':
			return (typeof bareValue === 'number' || typeof bareValue === 'string')
				&& String(bareValue).trim() !== ''
				&& !Number.isNaN(toNumber(bareValue))
				? null
				: `${quotedName} is ${quotedValue}, which is not a number.`;
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

	const declaredFlag = envDeclaration.type === 'string[]'
		? 'array'
		: envDeclaration.type;

	if (castFlag !== null && castFlag !== declaredFlag) {
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

	if (envDeclaration.values.includes(castValue as string)) {
		return null;
	}

	const quotedChoices = envDeclaration.values
		.map((choice) => JSON.stringify(choice))
		.join(', ');

	return `${quotedName} is ${JSON.stringify(castValue)}, which is not one of`
		+ ` ${quotedChoices}.`;
};
