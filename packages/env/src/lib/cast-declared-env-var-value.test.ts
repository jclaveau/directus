import { expect, test } from 'vitest';
import { cast, castDeclaredEnvVarValue } from './cast.js';

test('a string declaration keeps the leading zero a guess drops', () => {
	expect(cast('0123')).toBe('0123');
	expect(cast('123')).toBe(123);
	expect(castDeclaredEnvVarValue('123', { type: 'string' })).toBe('123');
	expect(castDeclaredEnvVarValue('0123', { type: 'string' })).toBe('0123');
});

test('a declaration casts a value without its prefix', () => {
	expect(castDeclaredEnvVarValue('number:42', { type: 'number' })).toBe(42);
});

test('a boolean declaration reads "1" as true', () => {
	expect(castDeclaredEnvVarValue('1', { type: 'boolean' })).toBe(true);
});

test.each([
	['false | number', 'false', false],
	['false | number', false, false],
	['false | number', '2147483648', 2147483648],
	['false | string', 'false', false],
	['false | string', '10mb', '10mb'],
	['false | string[]', 'false', false],
	['false | string[]', 'PUBLIC_URL,PORT', ['PUBLIC_URL', 'PORT']],
	['boolean | number | string | string[]', 'true', true],
	['boolean | number | string | string[]', 'false', false],
	['boolean | number | string | string[]', '1', 1],
	['boolean | number | string | string[]', '0', 0],
	['boolean | number | string | string[]', '*', '*'],
	[
		'boolean | number | string | string[]',
		'127.0.0.1,128.1.0.3',
		['127.0.0.1', '128.1.0.3'],
	],
] as const)(
	'a %s declaration casts %j to %j',
	(declaredType, rawValue, castValue) => {
		expect(castDeclaredEnvVarValue(rawValue, { type: declaredType }))
			.toEqual(castValue);
	},
);

test('an array: prefix wins over the CORS_ORIGIN guess', () => {
	expect(cast('array:*', 'CORS_ORIGIN')).toEqual(['*']);
});

test('a WEBSOCKETS_*_CONN_LIMIT reads Infinity as a number', () => {
	expect(cast('Infinity', 'WEBSOCKETS_REST_CONN_LIMIT')).toBe(Infinity);
});
