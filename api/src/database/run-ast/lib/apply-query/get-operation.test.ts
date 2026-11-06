import { expect, test } from 'vitest';
import { getOperation } from './get-operation.js';

test('key object without operator', () => {
	const result = getOperation('key', {
		key: 'Hi',
	});

	expect(result).toEqual({
		operator: '_eq',
		value: 'Hi',
	});
});

test('key object with _neq operator', () => {
	const result = getOperation('key', {
		_neq: 'Hi',
	});

	expect(result).toEqual({
		operator: '_neq',
		value: 'Hi',
	});
});

test('key object with nested _in operator', () => {
	const result = getOperation('key', {
		nested: {
			_in: [1, 2, 3],
		},
	});

	expect(result).toEqual({
		operator: '_in',
		value: [1, 2, 3],
	});
});

test('key as _eq object with nested _in operator', () => {
	const result = getOperation('_eq', 123);

	expect(result).toEqual({
		operator: '_eq',
		value: 123,
	});
});

for (const key of ['_some', '_none']) {
	test(`skipping of ${key}`, () => {
		const result = getOperation(key, {
			field: 1,
		});

		expect(result).toEqual({
			operator: '_eq',
			value: 1,
		});
	});
}

test('_some over an _and returns the _some', () => {
	expect(
		getOperation('_some', {
			_and: [{ name: { _eq: 'a' } }, { status: { _eq: 'b' } }],
		}),
	).toEqual({
		operator: '_some',
		value: {
			_and: [{ name: { _eq: 'a' } }, { status: { _eq: 'b' } }],
		},
	});
});

test('_none over an _or returns the _none', () => {
	expect(
		getOperation('_none', {
			_or: [{ name: { _eq: 'a' } }, { name: { _eq: 'b' } }],
		}),
	).toEqual({
		operator: '_none',
		value: {
			_or: [{ name: { _eq: 'a' } }, { name: { _eq: 'b' } }],
		},
	});
});

for (const key of ['_and', '_or']) {
	test(`key as invalid ${key}`, () => {
		const result = getOperation(key, {});

		expect(result).toBeNull();
	});
}

test('empty object', () => {
	const result = getOperation('key', {});

	expect(result).toBeNull();
});

test('nested empty object', () => {
	const result = getOperation('_or', {
		nested: {},
	});

	expect(result).toBeNull();
});

for (const [title, content] of [
	['an empty _and', { _and: [] }],
	['an empty _or', { _or: [] }],
	['an _and holding an empty filter', { _and: [{}] }],
	['an _or holding an empty filter', { _or: [{}] }],
	['a nested empty quantifier', { sub: { _some: {} } }],
] as const) {
	for (const key of ['_some', '_none']) {
		test(`${key} over ${title} reads no field`, () => {
			expect(getOperation(key, content)).toBeNull();
		});
	}
}
