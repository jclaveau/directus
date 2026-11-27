import { describe, expect, test } from 'vitest';
import { checkDeclaredEnvVarValue } from './check-declared-env-var-value.js';

describe('checkDeclaredEnvVarValue', () => {
	test.each([
		['number', '5432'],
		['number', 'number:5432'],
		['number', 5432],
		['boolean', 'true'],
		['boolean', '0'],
		['boolean', false],
		['regex', '^/admin'],
		['json', '{"a":1}'],
		['json', { a: 1 }],
		['string', '0123'],
		['string[]', 'a,b'],
		['string[]', 'array:a,b'],
		['false | number', 'false'],
		['false | number', false],
		['false | number', '2147483648'],
		['false | number', 'number:2147483648'],
		['false | string', '10mb'],
		['false | string[]', 'array:PORT'],
		['number', 'Infinity'],
		['boolean | number | string | string[]', '*'],
		['boolean | number | string | string[]', '1'],
		['boolean | number | string | string[]', 'array:*'],
	] as const)('takes a %s set to %j', (declaredType, rawValue) => {
		expect(checkDeclaredEnvVarValue(
			'VARIABLE_NAME',
			rawValue,
			{ type: declaredType },
		)).toBe(null);
	});

	test.each([
		['number', 'abc', '"VARIABLE_NAME" is "abc", which is not a number.'],
		['number', '', '"VARIABLE_NAME" is "", which is not a number.'],
		['number', true, '"VARIABLE_NAME" is true, which is not a number.'],
		[
			'boolean',
			'yes',
			'"VARIABLE_NAME" is "yes", which is not a boolean:'
				+ ' use true, false, 1 or 0.',
		],
		['regex', '(', '"VARIABLE_NAME" is "(", which is not a regex.'],
		[
			'false | number',
			'2gb',
			'"VARIABLE_NAME" is "2gb", which is neither false nor a number.',
		],
		[
			'false | number',
			true,
			'"VARIABLE_NAME" is true, which is neither false nor a number.',
		],
		[
			'boolean | number | string | string[]',
			'json:["*"]',
			'"VARIABLE_NAME" is declared boolean | number | string | string[],'
				+ ' but its "json:" prefix casts it to json.',
		],
		['json', '{"secret":', '"VARIABLE_NAME" is not JSON.'],
		[
			'false | number',
			'number:false',
			'"VARIABLE_NAME" is "number:false", which is not a number.',
		],
		[
			'boolean | number | string | string[]',
			'number:abc',
			'"VARIABLE_NAME" is "number:abc", which is not a number.',
		],
		[
			'number',
			'string:5432',
			'"VARIABLE_NAME" is declared number, but its "string:" prefix'
				+ ' casts it to string.',
		],
		[
			'string[]',
			'json:["a"]',
			'"VARIABLE_NAME" is declared string[], but its "json:" prefix'
				+ ' casts it to json.',
		],
	] as const)('refuses a %s set to %j', (declaredType, rawValue, valueRefusal) => {
		expect(checkDeclaredEnvVarValue(
			'VARIABLE_NAME',
			rawValue,
			{ type: declaredType },
		)).toBe(valueRefusal);
	});

	test('takes one of the declared values', () => {
		expect(checkDeclaredEnvVarValue('CACHE_STORE', 'redis', {
			type: 'string',
			values: ['memory', 'redis'],
		})).toBe(null);
	});

	test('refuses a value outside the declared values', () => {
		expect(checkDeclaredEnvVarValue('CACHE_STORE', 'memcache', {
			type: 'string',
			values: ['memory', 'redis'],
		})).toBe(
			'"CACHE_STORE" is "memcache", which is not one of "memory", "redis".',
		);
	});
});
