import { describe, expect, test } from 'vitest';
import { isPrimaryKey } from './is-primary-key.js';

describe('isPrimaryKey', () => {
	test.each([
		['a string key', 'abc'],
		['a uuid', '0b1c2d3e-4f56-4789-8abc-def012345678'],
		['a numeric key', 42],
		['zero', 0],
		['an empty string', ''],
	])('accepts %s', (_label, value) => {
		expect(isPrimaryKey(value)).toBe(true);
	});

	test.each([
		['undefined', undefined],
		['null', null],
		['an object', { id: 1 }],
		['an array', [1]],
		['a boolean', true],
	])('rejects %s', (_label, value) => {
		expect(isPrimaryKey(value)).toBe(false);
	});
});
