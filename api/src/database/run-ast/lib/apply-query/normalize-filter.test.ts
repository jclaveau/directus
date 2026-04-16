import { describe, expect, test } from 'vitest';
import { normalizeFilter } from './normalize-filter.js';

describe('normalizeFilter', () => {
	test('returns empty filter unchanged', () => {
		expect(normalizeFilter({})).toEqual({});
	});

	test('returns simple operator filter unchanged', () => {
		const filter = { field: { _eq: 'value' } };
		expect(normalizeFilter(filter)).toEqual(filter);
	});

	test('returns single relational path unchanged', () => {
		const filter = { rel: { sub: { _eq: 'value' } } };
		expect(normalizeFilter(filter)).toEqual(filter);
	});

	test('returns deep single relational path unchanged', () => {
		const filter = { a: { b: { c: { d: { _eq: 1 } } } } };
		expect(normalizeFilter(filter)).toEqual(filter);
	});

	test('splits sibling relational keys into _and', () => {
		const filter = {
			rel: {
				field_a: { _eq: 1 },
				field_b: { _eq: 2 },
			},
		};

		// prettier-ignore
		expect(normalizeFilter(filter)).toEqual({
			_and: [
				{ rel: { field_a: { _eq: 1 } } },
				{ rel: { field_b: { _eq: 2 } } },
			],
		});
	});

	test('splits deeply nested sibling keys', () => {
		const filter = {
			a: {
				b: {
					c: { _eq: 1 },
					d: { _eq: 2 },
				},
			},
		};

		// prettier-ignore
		expect(normalizeFilter(filter)).toEqual({
			_and: [
				{ a: { b: { c: { _eq: 1 } } } },
				{ a: { b: { d: { _eq: 2 } } } },
			],
		});
	});

	test('splits at multiple nesting levels', () => {
		const filter = {
			a: {
				b: {
					x: { _eq: 1 },
					y: { _eq: 2 },
				},
				c: { _eq: 3 },
			},
		};

		// prettier-ignore
		expect(normalizeFilter(filter)).toEqual({
			_and: [
				{ a: { b: { x: { _eq: 1 } } } },
				{ a: { b: { y: { _eq: 2 } } } },
				{ a: { c: { _eq: 3 } } },
			],
		});
	});

	test('preserves _and arrays and normalizes their contents', () => {
		const filter = {
			_and: [
				{
					rel: {
						a: { _eq: 1 },
						b: { _eq: 2 },
					},
				},
			],
		};

		// prettier-ignore
		expect(normalizeFilter(filter)).toEqual({
			_and: [
				{
					_and: [
						{ rel: { a: { _eq: 1 } } },
						{ rel: { b: { _eq: 2 } } },
					],
				},
			],
		});
	});

	test('preserves _or arrays and normalizes their contents', () => {
		const filter = {
			_or: [
				{
					rel: {
						a: { _eq: 1 },
						b: { _eq: 2 },
					},
				},
			],
		};

		// prettier-ignore
		expect(normalizeFilter(filter)).toEqual({
			_or: [
				{
					_and: [
						{ rel: { a: { _eq: 1 } } },
						{ rel: { b: { _eq: 2 } } },
					],
				},
			],
		});
	});

	test('handles mixed operator and relational keys', () => {
		const filter = {
			field: {
				_eq: 'direct',
				sub: { _eq: 'nested' },
			},
		};

		// prettier-ignore
		expect(normalizeFilter(filter)).toEqual({
			_and: [
				{ field: { sub: { _eq: 'nested' } } },
				{ field: { _eq: 'direct' } },
			],
		});
	});

	test('keeps multiple operator keys on same field together', () => {
		const filter = { field: { _gte: 1, _lte: 10 } };
		expect(normalizeFilter(filter)).toEqual(filter);
	});

	test('handles _some as relational key', () => {
		const filter = {
			rel: {
				_some: { field: { _eq: 1 } },
				other: { _eq: 2 },
			},
		};

		// prettier-ignore
		expect(normalizeFilter(filter)).toEqual({
			_and: [
				{ rel: { _some: { field: { _eq: 1 } } } },
				{ rel: { other: { _eq: 2 } } },
			],
		});
	});

	test('handles _none as relational key', () => {
		const filter = {
			rel: {
				_none: { field: { _eq: 1 } },
				other: { _eq: 2 },
			},
		};

		// prettier-ignore
		expect(normalizeFilter(filter)).toEqual({
			_and: [
				{ rel: { _none: { field: { _eq: 1 } } } },
				{ rel: { other: { _eq: 2 } } },
			],
		});
	});

	test('preserves flat structure when top-level keys are unique', () => {
		const filter = {
			field_a: { _eq: 1 },
			field_b: { _eq: 2 },
			rel: { sub: { _eq: 3 } },
		};

		expect(normalizeFilter(filter)).toEqual(filter);
	});

	test('handles non-object filter values', () => {
		const filter = { field: 'direct-value' };
		expect(normalizeFilter(filter as any)).toEqual({ field: 'direct-value' });
	});

	test('deeply nested m2o chain with sibling filters at multiple levels', () => {
		const filter = {
			field_a: { _eq: 'value-a' },
			field_b: { _in: ['x', 'y'] },
			rel_1: {
				rel_2: {
					rel_3: {
						status: { _eq: 'active' },
						rel_4: {
							status: { _eq: 'active' },
							rel_5: {
								status: { _eq: 'active' },
							},
						},
					},
					status: { _eq: 'active' },
				},
			},
		};

		const normalized = normalizeFilter(filter);

		// All paths should be fully separated - each with a single relational chain
		expect(normalized).toEqual({
			_and: [
				{ field_a: { _eq: 'value-a' } },
				{ field_b: { _in: ['x', 'y'] } },
				{ rel_1: { rel_2: { rel_3: { status: { _eq: 'active' } } } } },
				{ rel_1: { rel_2: { rel_3: { rel_4: { status: { _eq: 'active' } } } } } },
				{ rel_1: { rel_2: { rel_3: { rel_4: { rel_5: { status: { _eq: 'active' } } } } } } },
				{ rel_1: { rel_2: { status: { _eq: 'active' } } } },
			],
		});
	});
});
