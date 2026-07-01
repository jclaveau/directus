import { oneLine } from '@directus/utils';
import { describe, expect, test } from 'vitest';
import {
	pinnedScopedCacheTagsFromFilter,
	scopedCacheTagsFromRows,
} from '../scoped-cache.js';

// Pure scope-tag derivation behind update-payload / create tagging
// (requireAll toggles fatal-on-missing).
describe('scopedCacheTagsFromRows', () => {
	test('one tag per distinct value per field', () => {
		const rows = [
			{ student: 'A', course: 'math' },
			{ student: 'B', course: 'math' },
			{ student: 'A', course: 'art' },
		];

		expect(scopedCacheTagsFromRows('slots', ['student', 'course'], rows, true)).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
			{ collection: 'slots', field: 'student', value: 'B' },
			{ collection: 'slots', field: 'course', value: 'math' },
			{ collection: 'slots', field: 'course', value: 'art' },
		]);
	});

	test('null and numeric values are kept distinct', () => {
		const rows = [{ student: null }, { student: 0 }, { student: null }];

		expect(scopedCacheTagsFromRows('slots', ['student'], rows, true)).toEqual([
			{ collection: 'slots', field: 'student', value: null },
			{ collection: 'slots', field: 'student', value: 0 },
		]);
	});

	test(oneLine`
		requireAll returns null when a field is not present on a row (unprojected read /
		omitted create)
	`, () => {
		const rows = [{ student: 'A' }, { course: 'math' }];

		expect(scopedCacheTagsFromRows('slots', ['student'], rows, true)).toBeNull();
	});

	test(oneLine`
		without requireAll a missing field is skipped, not fatal (update payload that leaves
		it unchanged)
	`, () => {
		const rows = [{ student: 'A' }, { course: 'math' }];

		expect(scopedCacheTagsFromRows('slots', ['student'], rows, false)).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
		]);
	});

	test(oneLine`
		a field present but holding null is resolvable (distinct from being absent)
	`, () => {
		expect(
			scopedCacheTagsFromRows('slots', ['student'], [{ student: null }], true),
		).toEqual([
			{ collection: 'slots', field: 'student', value: null },
		]);
	});

	test(oneLine`
		empty rows resolve to an empty tag list, not null (caller falls back to a
		collection-level tag)
	`, () => {
		expect(scopedCacheTagsFromRows('slots', ['student'], [], true)).toEqual([]);
	});

	test('no configured fields yields no scoped cache tags', () => {
		expect(scopedCacheTagsFromRows('slots', [], [{ student: 'A' }], true)).toEqual([]);
	});
});

// Read-side scoping: only a filter that BOUNDS the read to a scope value may scope it
// (else an insert of a new value would silently miss the cached read). An empty result
// means "not bounded → bare tag".
describe('pinnedScopedCacheTagsFromFilter', () => {
	test('_eq on a scope field pins that value', () => {
		expect(
			pinnedScopedCacheTagsFromFilter('slots', ['student'], { student: { _eq: 'A' } }),
		).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
		]);
	});

	test(oneLine`
		_in on a scope field pins every listed value (even those with no rows yet)
	`, () => {
		expect(
			pinnedScopedCacheTagsFromFilter('slots', ['student'], {
				student: { _in: ['A', 'B'] },
			}),
		).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
			{ collection: 'slots', field: 'student', value: 'B' },
		]);
	});

	test('constraints reached through _and pin', () => {
		const filter = { _and: [{ student: { _eq: 'A' } }, { course: { _eq: 'math' } }] };

		expect(
			pinnedScopedCacheTagsFromFilter('slots', ['student', 'course'], filter),
		).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
			{ collection: 'slots', field: 'course', value: 'math' },
		]);
	});

	test('an _or branch does not bound the read, so nothing under it pins', () => {
		const filter = { _or: [{ student: { _eq: 'A' } }, { student: { _eq: 'B' } }] };
		expect(pinnedScopedCacheTagsFromFilter('slots', ['student'], filter)).toEqual([]);
	});

	test('a non-equality operator (_gt) does not bound the read', () => {
		expect(
			pinnedScopedCacheTagsFromFilter('slots', ['student'], { student: { _gt: 'A' } }),
		).toEqual([]);
	});

	test(oneLine`
		a filter on a non-scope field yields no pin (read falls back to the bare collection
		tag)
	`, () => {
		expect(
			pinnedScopedCacheTagsFromFilter('slots', ['student'], { course: { _eq: 'math' } }),
		).toEqual([]);
	});

	test('empty / null filter yields no pin', () => {
		expect(pinnedScopedCacheTagsFromFilter('slots', ['student'], null)).toEqual([]);
		expect(pinnedScopedCacheTagsFromFilter('slots', ['student'], {})).toEqual([]);
	});
});
