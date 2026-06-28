import type { Accountability } from '@directus/types';
import { describe, expect, test } from 'vitest';
import { pinnedScopeTagsFromCases, pinnedScopeTagsFromFilter, scopedCacheTagsFromRows } from './items.js';

const alice = { user: 'alice-id', role: 'student-role' } as Accountability;

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

// Read-side scoping: only a filter that BOUNDS the read to a scope value may scope it
// (else an insert of a new value would silently miss the cached read). An empty result
// means "not bounded → bare tag".
describe('pinnedScopeTagsFromFilter', () => {
	test('_eq on a scope field pins that value', () => {
		expect(pinnedScopeTagsFromFilter('slots', ['student'], { student: { _eq: 'A' } })).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
		]);
	});

	test('_in on a scope field pins every listed value (even those with no rows yet)', () => {
		expect(pinnedScopeTagsFromFilter('slots', ['student'], { student: { _in: ['A', 'B'] } })).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
			{ collection: 'slots', field: 'student', value: 'B' },
		]);
	});

	test('constraints reached through _and pin', () => {
		const filter = { _and: [{ student: { _eq: 'A' } }, { course: { _eq: 'math' } }] };

		expect(pinnedScopeTagsFromFilter('slots', ['student', 'course'], filter)).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
			{ collection: 'slots', field: 'course', value: 'math' },
		]);
	});

	test('an _or branch does not bound the read, so nothing under it pins', () => {
		const filter = { _or: [{ student: { _eq: 'A' } }, { student: { _eq: 'B' } }] };
		expect(pinnedScopeTagsFromFilter('slots', ['student'], filter)).toEqual([]);
	});

	test('a non-equality operator (_gt) does not bound the read', () => {
		expect(pinnedScopeTagsFromFilter('slots', ['student'], { student: { _gt: 'A' } })).toEqual([]);
	});

	test('a filter on a non-scope field yields no pin (read falls back to the bare collection tag)', () => {
		expect(pinnedScopeTagsFromFilter('slots', ['student'], { course: { _eq: 'math' } })).toEqual([]);
	});

	test('empty / null filter yields no pin', () => {
		expect(pinnedScopeTagsFromFilter('slots', ['student'], null)).toEqual([]);
		expect(pinnedScopeTagsFromFilter('slots', ['student'], {})).toEqual([]);
	});
});

// Permission-aware read scoping: a single permission case bounds the result (rows
// that don't match are excluded), so it pins like an explicit filter — after resolving
// the trivial dynamic variables. This is what value-scopes a permission-isolated read
// whose partition lives in permissions, not the API query.
describe('pinnedScopeTagsFromCases', () => {
	test('a single case with $CURRENT_USER on a scope field pins the resolved user id', () => {
		expect(pinnedScopeTagsFromCases('slots', ['student'], [{ student: { _eq: '$CURRENT_USER' } }], alice)).toEqual([
			{ collection: 'slots', field: 'student', value: 'alice-id' },
		]);
	});

	test('$CURRENT_ROLE resolves to the accountability role', () => {
		expect(pinnedScopeTagsFromCases('slots', ['student'], [{ student: { _eq: '$CURRENT_ROLE' } }], alice)).toEqual([
			{ collection: 'slots', field: 'student', value: 'student-role' },
		]);
	});

	test('a literal value in a single case pins directly', () => {
		expect(pinnedScopeTagsFromCases('slots', ['student'], [{ student: { _eq: 'A' } }], alice)).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
		]);
	});

	test('a case reached through _and pins', () => {
		const cases = [{ _and: [{ student: { _eq: '$CURRENT_USER' } }, { course: { _eq: 'math' } }] }];

		expect(pinnedScopeTagsFromCases('slots', ['student', 'course'], cases, alice)).toEqual([
			{ collection: 'slots', field: 'student', value: 'alice-id' },
			{ collection: 'slots', field: 'course', value: 'math' },
		]);
	});

	test('multiple cases are OR-combined — none bounds, so nothing pins', () => {
		const cases = [{ student: { _eq: '$CURRENT_USER' } }, { student: { _eq: 'shared' } }];
		expect(pinnedScopeTagsFromCases('slots', ['student'], cases, alice)).toEqual([]);
	});

	test('no cases (unrestricted item access) pins nothing', () => {
		expect(pinnedScopeTagsFromCases('slots', ['student'], [], alice)).toEqual([]);
		expect(pinnedScopeTagsFromCases('slots', ['student'], undefined, alice)).toEqual([]);
	});

	test('an unresolvable dynamic ($CURRENT_USER.team) does not pin — read stays bare-tagged', () => {
		expect(pinnedScopeTagsFromCases('slots', ['student'], [{ student: { _eq: '$CURRENT_USER.team' } }], alice)).toEqual(
			[],
		);
	});

	test('an _in mixing a concrete value and an unresolvable dynamic skips the field (no partial bound)', () => {
		const cases = [{ student: { _in: ['A', '$CURRENT_POLICIES'] } }];
		expect(pinnedScopeTagsFromCases('slots', ['student'], cases, alice)).toEqual([]);
	});
});
