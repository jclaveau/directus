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

		expect(normalizeFilter(filter)).toEqual({
			_and: [{ rel: { field_a: { _eq: 1 } } }, { rel: { field_b: { _eq: 2 } } }],
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

		expect(normalizeFilter(filter)).toEqual({
			_and: [{ a: { b: { c: { _eq: 1 } } } }, { a: { b: { d: { _eq: 2 } } } }],
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

		expect(normalizeFilter(filter)).toEqual({
			_and: [{ a: { b: { x: { _eq: 1 } } } }, { a: { b: { y: { _eq: 2 } } } }, { a: { c: { _eq: 3 } } }],
		});
	});

	test('never nests _and/_or inside a relational value (the getFilterPath invariant)', () => {
		// liftAndPush must keep the logical wrapper at the top, not buried in a relational value
		// where getFilterPath (which only follows Object.keys(value)[0]) would mishandle it.
		const filter = {
			a: {
				b: {
					c: { _eq: 1 },
					d: { _eq: 2 },
				},
				e: { _eq: 3 },
			},
		};

		const isPlainObject = (node: unknown): node is Record<string, unknown> =>
			typeof node === 'object' && node !== null && !Array.isArray(node);

		const relationalValueContainsLogical = (node: unknown): boolean => {
			if (!isPlainObject(node)) return false;

			for (const [key, value] of Object.entries(node)) {
				if (key === '_and' || key === '_or') {
					// a top-level logical wrapper is fine; recurse into its sub-filters
					if ((value as unknown[]).some(relationalValueContainsLogical)) return true;
				} else if (isPlainObject(value)) {
					// `value` is a relational/operator object: it must not introduce a logical wrapper
					if ('_and' in value || '_or' in value) return true;
					if (relationalValueContainsLogical(value)) return true;
				}
			}

			return false;
		};

		expect(relationalValueContainsLogical(normalizeFilter(filter))).toBe(false);
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

		expect(normalizeFilter(filter)).toEqual({
			_and: [
				{
					_and: [{ rel: { a: { _eq: 1 } } }, { rel: { b: { _eq: 2 } } }],
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

		expect(normalizeFilter(filter)).toEqual({
			_or: [
				{
					_and: [{ rel: { a: { _eq: 1 } } }, { rel: { b: { _eq: 2 } } }],
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

		expect(normalizeFilter(filter)).toEqual({
			_and: [{ field: { sub: { _eq: 'nested' } } }, { field: { _eq: 'direct' } }],
		});
	});

	test('splits multiple operator keys on the same field', () => {
		// They cannot share one part: `getOperation` reads `Object.keys(value)[0]` and
		// returns that operator alone, so `{ _gte, _lte }` compiled to `field >= 1` with
		// the `_lte` silently dropped. This test previously asserted the merged shape.
		const filter = { field: { _gte: 1, _lte: 10 } };

		expect(normalizeFilter(filter)).toEqual({
			_and: [{ field: { _gte: 1 } }, { field: { _lte: 10 } }],
		});
	});

	test('handles _some as relational key', () => {
		const filter = {
			rel: {
				_some: { field: { _eq: 1 } },
				other: { _eq: 2 },
			},
		};

		expect(normalizeFilter(filter)).toEqual({
			_and: [{ rel: { _some: { field: { _eq: 1 } } } }, { rel: { other: { _eq: 2 } } }],
		});
	});

	test('handles _none as relational key', () => {
		const filter = {
			rel: {
				_none: { field: { _eq: 1 } },
				other: { _eq: 2 },
			},
		};

		expect(normalizeFilter(filter)).toEqual({
			_and: [{ rel: { _none: { field: { _eq: 1 } } } }, { rel: { other: { _eq: 2 } } }],
		});
	});

	test('wraps unique top-level keys in _and rather than merging them flat', () => {
		const filter = {
			field_a: { _eq: 1 },
			field_b: { _eq: 2 },
			rel: { sub: { _eq: 3 } },
		};

		expect(normalizeFilter(filter)).toEqual({
			_and: [
				{ field_a: { _eq: 1 } },
				{ field_b: { _eq: 2 } },
				{ rel: { sub: { _eq: 3 } } },
			],
		});
	});

	test('wraps a multi-key _or element so its siblings stay ANDed', () => {
		// The element's keys are distinct top-level fields with operator-only children,
		// so nothing above forces a split — but `addWhereClauses` recurses an `_or`
		// element with `logical = 'or'`, and would OR these three against each other.
		const filter = {
			_or: [
				{
					course_part: { _eq: 1 },
					day: { _eq: '2023-09-19' },
					method_range: { _in: ['a', 'b'] },
				},
			],
		};

		expect(normalizeFilter(filter)).toEqual({
			_or: [
				{
					_and: [
						{ course_part: { _eq: 1 } },
						{ day: { _eq: '2023-09-19' } },
						{ method_range: { _in: ['a', 'b'] } },
					],
				},
			],
		});
	});

	test('wraps every multi-key _or element, and leaves single-key ones alone', () => {
		const filter = {
			_or: [
				{ status: { _eq: 'published' } },
				{ author: { _eq: 7 }, status: { _eq: 'draft' } },
			],
		};

		expect(normalizeFilter(filter)).toEqual({
			_or: [
				{ status: { _eq: 'published' } },
				{ _and: [{ author: { _eq: 7 } }, { status: { _eq: 'draft' } }] },
			],
		});
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
