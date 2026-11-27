import { expect, test } from 'vitest';
import { getDefaultType } from '../utils/get-default-type.js';
import { castEnvVarValue } from './cast.js';

test('a string declaration keeps the leading zero a guess drops', () => {
	expect(castEnvVarValue('0123', null)).toBe('0123');
	expect(castEnvVarValue('123', null)).toBe(123);
	expect(castEnvVarValue('123', 'string')).toBe('123');
	expect(castEnvVarValue('0123', 'string')).toBe('0123');
});

test('a declaration casts a value without its prefix', () => {
	expect(castEnvVarValue('number:42', 'number')).toBe(42);
});

test('a boolean declaration reads "1" as true', () => {
	expect(castEnvVarValue('1', 'boolean')).toBe(true);
});

// An extension's boolean the check takes in any case casts as it reads.
test('a boolean declaration reads " TRUE " as true', () => {
	expect(castEnvVarValue(' TRUE ', 'boolean')).toBe(true);
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
		expect(castEnvVarValue(rawValue, declaredType))
			.toEqual(castValue);
	},
);

test('an array: prefix wins over the CORS_ORIGIN guess', () => {
	expect(castEnvVarValue('array:*', getDefaultType('CORS_ORIGIN'))).toEqual(['*']);
});

test('a WEBSOCKETS_*_CONN_LIMIT reads Infinity as a number', () => {
	expect(castEnvVarValue(
		'Infinity',
		getDefaultType('WEBSOCKETS_REST_CONN_LIMIT'),
	)).toBe(Infinity);
});

// As the base read it: CORS_ORIGIN='["https://a.com"]' is the list.
test('a boolean | number | string | string[] declaration parses a JSON list', () => {
	expect(castEnvVarValue(
		'["https://a.com"]',
		'boolean | number | string | string[]',
	)).toEqual(['https://a.com']);
});

test('the items of an undeclared array: value are guessed', () => {
	expect(castEnvVarValue('array:1,true', null)).toEqual([1, true]);
});

test('the items of a declared string[] stay strings under array:', () => {
	expect(castEnvVarValue(
		'array:1,true',
		getDefaultType('AUTH_PROVIDERS'),
	)).toEqual(['1', 'true']);
});

// A prefix wins in core and in an extension alike.
test('array:false casts to a list on a false | string[] declaration', () => {
	expect(castEnvVarValue(
		'array:false',
		getDefaultType('FLOWS_ENV_ALLOW_LIST'),
	)).toEqual(['false']);

	expect(castEnvVarValue('array:false', 'false | string[]')).toEqual(['false']);
});
