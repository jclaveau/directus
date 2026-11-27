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
		// A config file's scalar reads as its string: `PORT: 8055` in yaml.
		['string', 8055],
		// `toBoolean`'s spellings in any case, spaces around them.
		['boolean', ' TRUE\n'],
		['boolean', 'boolean:False'],
		['string[]', ['a', 'b']],
		['string[]', [1, 2]],
		['false | string', false],
		['false | string[]', false],
		['false | string[]', ['PORT']],
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
			'"VARIABLE_NAME" Environment Variable is "yes", which is not a'
				+ ' boolean. Use one of true, false, 1, 0.',
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

	test.each([
		[
			'EMAIL_FROM',
			'string',
			{ name: 'Scalabus' },
			'"EMAIL_FROM" is {"name":"Scalabus"}, which is not a string.',
		],
		[
			'STORAGE_LOCATIONS',
			'string[]',
			{ local: true },
			'"STORAGE_LOCATIONS" is {"local":true},'
				+ ' which is neither a string nor a list of strings.',
		],
		[
			'STORAGE_LOCATIONS',
			'string[]',
			[{ local: true }],
			'"STORAGE_LOCATIONS" is [{"local":true}],'
				+ ' which is neither a string nor a list of strings.',
		],
		[
			'ROOT_REDIRECT',
			'false | string',
			{ to: '/admin' },
			'"ROOT_REDIRECT" is {"to":"/admin"},'
				+ ' which is neither false nor a string.',
		],
		[
			'FLOWS_ENV_ALLOW_LIST',
			'false | string[]',
			{ PORT: true },
			'"FLOWS_ENV_ALLOW_LIST" is {"PORT":true},'
				+ ' which is neither false, a string nor a list of strings.',
		],
		// The value is left out when the name may hold a secret.
		[
			'DB_PASSWORD',
			'string',
			{ password: 'hunter2' },
			'"DB_PASSWORD" is not a string.',
		],
		[
			'AUTH_GOOGLE_CLIENT_SECRET',
			'false | string',
			['hunter2'],
			'"AUTH_GOOGLE_CLIENT_SECRET" is neither false nor a string.',
		],
	] as const)('refuses %s, a %s, set to %j', (
		envVarName,
		declaredType,
		rawValue,
		valueRefusal,
	) => {
		expect(checkDeclaredEnvVarValue(
			envVarName,
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
