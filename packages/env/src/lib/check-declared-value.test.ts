import { describe, expect, test } from 'vitest';
import { checkDeclaredValue } from './check-declared-value.js';

describe('checkDeclaredValue', () => {
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
	] as const)('takes a %s set to %j', (type, value) => {
		expect(checkDeclaredValue('VARIABLE_NAME', value, { type }))
			.toBe(null);
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
		['json', '{"secret":', '"VARIABLE_NAME" is not JSON.'],
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
	] as const)('refuses a %s set to %j', (type, value, refusal) => {
		expect(checkDeclaredValue('VARIABLE_NAME', value, { type }))
			.toBe(refusal);
	});

	test('takes one of the declared values', () => {
		expect(checkDeclaredValue('CACHE_STORE', 'redis', {
			type: 'string',
			values: ['memory', 'redis'],
		})).toBe(null);
	});

	test('refuses a value outside the declared values', () => {
		expect(checkDeclaredValue('CACHE_STORE', 'memcache', {
			type: 'string',
			values: ['memory', 'redis'],
		})).toBe(
			'"CACHE_STORE" is "memcache", which is not one of "memory", "redis".',
		);
	});
});
