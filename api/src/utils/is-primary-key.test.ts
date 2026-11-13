import { describe, expect, test } from 'vitest';
import { isMissingPrimaryKey, isPrimaryKey } from './is-primary-key.js';

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

describe('isMissingPrimaryKey', () => {
	test.each([
		['undefined', undefined],
		['null', null],
		['an empty string', ''],
	])('counts %s as no key', (_label, value) => {
		expect(isMissingPrimaryKey(value)).toBe(true);
	});

	test.each([
		['zero', 0],
		['a numeric key', 42],
		['a string key', 'abc'],
	])('counts %s as a key', (_label, value) => {
		expect(isMissingPrimaryKey(value)).toBe(false);
	});
});
