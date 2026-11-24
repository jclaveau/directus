import { toArray, toBoolean } from '@directus/utils/values';
import type { EnvDeclaration } from '../types/env-declaration.js';
import type { EnvType } from '../types/env-type.js';
import { getDefaultType } from '../utils/get-default-type.js';
import { guessType } from '../utils/guess-type.js';
import { getCastFlag } from '../utils/has-cast-prefix.js';
import { toNumber, toString } from '../utils/lodash-es-used.js';
import { tryJson } from '../utils/try-json.js';

const castToType = (value: unknown, type: EnvType): unknown => {
	switch (type) {
		case 'string':
			return toString(value);
		case 'number':
			return toNumber(value);
		case 'boolean':
			return toBoolean(value);
		case 'regex':
			return new RegExp(String(value));
		case 'array':
			return toArray(value)
				.map((v) => cast(v))
				.filter((v) => v !== '');
		case 'json':
			return tryJson(value);
	}
};

/** `value` without the `type:` prefix it may carry. */
export const stripCastFlag = (value: unknown): unknown => {
	const castFlag = getCastFlag(value);

	return typeof value === 'string' && castFlag
		? value.substring(castFlag.length + 1)
		: value;
};

export const cast = (value: unknown, key?: string): unknown => {
	const castFlag = getCastFlag(value);

	const type = castFlag ?? getDefaultType(key) ?? guessType(value);

	return castToType(stripCastFlag(value), type);
};

/**
 * `value` cast to the type `envDeclaration` declares, whatever it looks like:
 * a string declaration keeps `"0123"` as `"0123"`.
 */
export const castDeclaredValue = (
	value: unknown,
	envDeclaration: EnvDeclaration,
): unknown => {
	return castToType(stripCastFlag(value), envDeclaration.type);
};
