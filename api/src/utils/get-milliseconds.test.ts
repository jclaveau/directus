import { expect, test } from 'vitest';
import { getMilliseconds, isPositiveDuration } from './get-milliseconds.js';

test.each([
	// accept human readable time format and plain number
	['1d', 86400000],
	['1000', 1000],
	[1000, 1000],
	// accept negative values
	['-1 minutes', -60000],
	[-1, -1],
	[0, 0],
	// fallback to undefined
	[null, undefined],
	[undefined, undefined],
	['', undefined],
	['invalid string', undefined],
	[false, undefined],
	[[], undefined],
	[{}, undefined],
	[Symbol(123), undefined],
	[
		() => {
			return 456;
		},
		undefined,
	],
])('should result into %s for input "%s"', (input, expected) => {
	expect(getMilliseconds(input)).toBe(expected);
});

test('should return custom fallback on invalid value', () => {
	expect(getMilliseconds(undefined, 0)).toBe(0);
});

test.each([
	// parseable to a positive number of ms
	['30s', true],
	['5m', true],
	['1.5h', true],
	['1000', true],
	// unparseable, zero, or negative — all rejected
	['abc', false],
	['30x', false],
	['-5m', false],
	['0', false],
	// empty / whitespace-only is guarded (ms throws on '')
	['', false],
	['   ', false],
])('isPositiveDuration("%s") is %s', (input, expected) => {
	expect(isPositiveDuration(input)).toBe(expected);
});
