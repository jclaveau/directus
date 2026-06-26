import { describe, expect, test } from 'vitest';
import { scopedCacheTagsFromRows } from './items.js';

// Pure scope-tag derivation behind read tagging (requireAll) and update-payload tagging (!requireAll).
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

	test('requireAll returns null when a field is not present on a row (unprojected read / omitted create)', () => {
		const rows = [{ student: 'A' }, { course: 'math' }];

		expect(scopedCacheTagsFromRows('slots', ['student'], rows, true)).toBeNull();
	});

	test('without requireAll a missing field is skipped, not fatal (update payload that leaves it unchanged)', () => {
		const rows = [{ student: 'A' }, { course: 'math' }];

		expect(scopedCacheTagsFromRows('slots', ['student'], rows, false)).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
		]);
	});

	test('a field present but holding null is resolvable (distinct from being absent)', () => {
		expect(scopedCacheTagsFromRows('slots', ['student'], [{ student: null }], true)).toEqual([
			{ collection: 'slots', field: 'student', value: null },
		]);
	});

	test('empty rows resolve to an empty tag list, not null (caller falls back to a collection-level tag)', () => {
		expect(scopedCacheTagsFromRows('slots', ['student'], [], true)).toEqual([]);
	});

	test('no configured fields yields no scoped cache tags', () => {
		expect(scopedCacheTagsFromRows('slots', [], [{ student: 'A' }], true)).toEqual([]);
	});
});
