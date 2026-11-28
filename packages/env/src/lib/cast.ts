import { toArray, toBoolean } from '@directus/utils/values';
import type { EnvVarDeclaredType, EnvType } from '../types/env-type.js';
import { guessType } from '../utils/guess-type.js';
import { getCastFlag } from '../utils/has-cast-prefix.js';
import { toNumber, toString } from '../utils/lodash-es-used.js';
import { tryJson } from '../utils/try-json.js';

/** The type of the value a `false | <type>` variable takes when not `false`. */
export const DISABLED_BY_FALSE_TYPES = {
	'false | number': 'number',
	'false | string': 'string',
	'false | string[]': 'string[]',
} as const;

const castToType = (
	value: unknown,
	type: EnvType | EnvVarDeclaredType,
): unknown => {
	switch (type) {
		case 'string':
			return toString(value);
		case 'number':
			return toNumber(value);
		case 'boolean':
			// Read in any case and with spaces around it, as the check takes it.
			return toBoolean(typeof value === 'string'
				? value.trim().toLowerCase()
				: value);
		case 'regex':
			return new RegExp(String(value));
		case 'array':
		case 'string[]':
			return type === 'array'
				? toArray(value)
					.map((item) => castEnvVarValue(item, null))
					.filter((item) => item !== '')
				: toArray(value)
					.map((item) => String(item))
					.filter((item) => item !== '');
		case 'json':
			return tryJson(value);
		case 'false | number':
		case 'false | string':
		case 'false | string[]':
			return value === false || value === 'false'
				? false
				: castToType(value, DISABLED_BY_FALSE_TYPES[type]);

		case 'null | string[]':
			return value === null || value === 'null'
				? null
				: castToType(value, 'string[]');
		case 'number | string':
			if (typeof value === 'number') {
				return value;
			}

			return /^\d+(\.\d+)?$/.test(String(value).trim())
				? Number(value)
				: toString(value);

		case 'boolean | number | string | string[]': {
			const guessedType = guessType(value);

			// guessType keeps `0` a string for its leading 0
			if (guessedType === 'json' && String(Number(value)) === value) {
				return Number(value);
			}

			return castToType(value, guessedType);
		}
	}
};

/** `value` without the `type:` prefix it may carry. */
export const stripCastFlag = (value: unknown): unknown => {
	const castFlag = getCastFlag(value);

	return typeof value === 'string' && castFlag
		? value.substring(castFlag.length + 1)
		: value;
};

/** The declared types an `array:` prefix keeps a list of strings. */
const STRING_LIST_DECLARED_TYPES: readonly EnvVarDeclaredType[] = [
	'string[]',
	'false | string[]',
	'null | string[]',
	'boolean | number | string | string[]',
];

/**
 * The type `castFlag` casts a variable declared `declaredType` to: the prefix
 * wins, but an `array:` one keeps a declared list of strings one.
 */
const readFlagCastType = (
	castFlag: EnvType,
	declaredType: EnvVarDeclaredType | null,
): EnvType | EnvVarDeclaredType => {
	return castFlag === 'array'
		&& declaredType !== null
		&& STRING_LIST_DECLARED_TYPES.includes(declaredType)
		? 'string[]'
		: castFlag;
};

/**
 * `value` cast by its prefix, else by `declaredType`, else by its guessed type:
 * a string declaration keeps `"0123"` as `"0123"`.
 */
export const castEnvVarValue = (
	value: unknown,
	declaredType: EnvVarDeclaredType | null,
): unknown => {
	const castFlag = getCastFlag(value);

	const castType = castFlag
		? readFlagCastType(castFlag, declaredType)
		: declaredType ?? guessType(value);

	return castToType(stripCastFlag(value), castType);
};
