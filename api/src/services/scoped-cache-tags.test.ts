import { oneLine } from '@directus/utils';
import { describe, expect, test } from 'vitest';
import {
	canonicalScopedCacheValue,
	pinnedScopedCacheTagsFromFilter,
	scopedCacheTagsFromRows,
} from '../scoped-cache.js';

// The read side derives a scope value from a (string-ish) query filter, the purge side from a
// native DB row. Both feed the same cache key, so a filter value and its stored counterpart must
// canonicalize identically — otherwise a write leaves the read's slice stale.
describe('canonicalScopedCacheValue', () => {
	test(oneLine`
		null and undefined share the null-byte sentinel, distinct from the literal "null"
	`, () => {
		expect(canonicalScopedCacheValue(null, 'string')).toBe('\x00null');
		expect(canonicalScopedCacheValue(undefined, 'string')).toBe('\x00null');
		expect(canonicalScopedCacheValue('null', 'string')).toBe('null');
	});

	test(oneLine`
		boolean: filter \`true\`/\`false\` and driver \`1\`/\`0\`/\`t\` collapse to one token
	`, () => {
		for (const truthy of [true, 1, '1', 't', 'true']) {
			expect(canonicalScopedCacheValue(truthy, 'boolean')).toBe('true');
		}

		for (const falsy of [false, 0, '0', 'f', 'false']) {
			expect(canonicalScopedCacheValue(falsy, 'boolean')).toBe('false');
		}
	});

	test(oneLine`
		datetime: an ISO string and a \`Date\` for the same instant collapse to epoch ms
	`, () => {
		const iso = '2026-01-02T03:04:05.000Z';

		for (const type of ['date', 'dateTime', 'timestamp'] as const) {
			expect(canonicalScopedCacheValue(iso, type))
				.toBe(canonicalScopedCacheValue(new Date(iso), type));
		}

		// Unparseable value falls back to its string form rather than NaN.
		expect(canonicalScopedCacheValue('not-a-date', 'dateTime')).toBe('not-a-date');
	});

	test('decimal/float: fixed-scale `"1.50"` and numeric `1.5` collapse', () => {
		expect(canonicalScopedCacheValue('1.50', 'decimal'))
			.toBe(canonicalScopedCacheValue(1.5, 'decimal'));

		expect(canonicalScopedCacheValue('2.0', 'float'))
			.toBe(canonicalScopedCacheValue(2, 'float'));
	});

	test(oneLine`
		integer/bigInteger keep \`String\` — \`7\` and \`"7"\` collapse, precision preserved
	`, () => {
		expect(canonicalScopedCacheValue(7, 'integer')).toBe('7');
		expect(canonicalScopedCacheValue('7', 'integer')).toBe('7');

		// Beyond Number.MAX_SAFE_INTEGER a numeric pass would corrupt; String keeps it exact.
		expect(canonicalScopedCacheValue('9007199254740993', 'bigInteger'))
			.toBe('9007199254740993');
	});

	test('unknown/undefined type falls back to `String` (owner-id/uuid path)', () => {
		expect(canonicalScopedCacheValue(42, undefined)).toBe('42');
		expect(canonicalScopedCacheValue('7c9e-uuid', 'uuid')).toBe('7c9e-uuid');
	});
});

// The field type must ride onto derived tags so key canonicalization sees it on both sides.
describe('scope-tag type propagation', () => {
	test('scopedCacheTagsFromRows stamps each tag with its field type', () => {
		const tags = scopedCacheTagsFromRows(
			'slots',
			['active'],
			[{ active: 1 }],
			'coarse',
			{ active: 'boolean' },
		);

		expect(tags).toEqual([
			{ collection: 'slots', field: 'active', value: 1, type: 'boolean' },
		]);
	});

	test(oneLine`
		pinnedScopedCacheTagsFromFilter stamps the pinned tag with its field type
	`, () => {
		const tags = pinnedScopedCacheTagsFromFilter(
			'slots',
			['active'],
			{ active: { _eq: true } },
			{ active: 'boolean' },
		);

		expect(tags).toEqual([
			{ collection: 'slots', field: 'active', value: true, type: 'boolean' },
		]);
	});
});

// Pure scope-tag derivation behind update-payload / create tagging
// (onUnresolvable picks coarse-fallback vs skip on a missing field).
describe('scopedCacheTagsFromRows', () => {
	test('one tag per distinct value per field', () => {
		const rows = [
			{ student: 'A', course: 'math' },
			{ student: 'B', course: 'math' },
			{ student: 'A', course: 'art' },
		];

		expect(
			scopedCacheTagsFromRows('slots', ['student', 'course'], rows, 'coarse'),
		).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
			{ collection: 'slots', field: 'student', value: 'B' },
			{ collection: 'slots', field: 'course', value: 'math' },
			{ collection: 'slots', field: 'course', value: 'art' },
		]);
	});

	test('dedups on the canonical token, so 7 and "7" collapse to one tag', () => {
		const rows = [{ student: 7 }, { student: '7' }];

		expect(
			scopedCacheTagsFromRows('slots', ['student'], rows, 'coarse', {
				student: 'integer',
			}),
		).toEqual([
			{ collection: 'slots', field: 'student', value: 7, type: 'integer' },
		]);
	});

	test('null and numeric values are kept distinct', () => {
		const rows = [{ student: null }, { student: 0 }, { student: null }];

		expect(scopedCacheTagsFromRows('slots', ['student'], rows, 'coarse')).toEqual([
			{ collection: 'slots', field: 'student', value: null },
			{ collection: 'slots', field: 'student', value: 0 },
		]);
	});

	test(oneLine`
		'coarse' returns null when a field is not present on a row (unprojected read /
		omitted create)
	`, () => {
		const rows = [{ student: 'A' }, { course: 'math' }];

		expect(scopedCacheTagsFromRows('slots', ['student'], rows, 'coarse')).toBeNull();
	});

	test(oneLine`
		'skip' skips a missing field instead of failing (update payload that leaves it
		unchanged)
	`, () => {
		const rows = [{ student: 'A' }, { course: 'math' }];

		expect(scopedCacheTagsFromRows('slots', ['student'], rows, 'skip')).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
		]);
	});

	test(oneLine`
		a field present but holding null is resolvable (distinct from being absent)
	`, () => {
		expect(
			scopedCacheTagsFromRows('slots', ['student'], [{ student: null }], 'coarse'),
		).toEqual([
			{ collection: 'slots', field: 'student', value: null },
		]);
	});

	test(oneLine`
		empty rows resolve to an empty tag list, not null (caller falls back to a
		collection-level tag)
	`, () => {
		expect(scopedCacheTagsFromRows('slots', ['student'], [], 'coarse')).toEqual([]);
	});

	test('no configured fields yields no scoped cache tags', () => {
		expect(
			scopedCacheTagsFromRows('slots', [], [{ student: 'A' }], 'coarse'),
		).toEqual([]);
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
		_eq: null pins the null slice — the read↔purge symmetry witness for a null-valued
		scope (matches the null-value purge tag)
	`, () => {
		expect(
			pinnedScopedCacheTagsFromFilter('slots', ['student'], { student: { _eq: null } }),
		).toEqual([
			{ collection: 'slots', field: 'student', value: null },
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

	test(oneLine`
		an _or whose every branch binds the field pins the UNION of their values — a row
		matches one branch, so its value is in the union
	`, () => {
		const filter = { _or: [{ student: { _eq: 'A' } }, { student: { _eq: 'B' } }] };

		expect(pinnedScopedCacheTagsFromFilter('slots', ['student'], filter)).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
			{ collection: 'slots', field: 'student', value: 'B' },
		]);
	});

	test(oneLine`
		an _or branch that leaves the field unbound drops the pin — a row matching that
		branch carries a value outside the union
	`, () => {
		const filter = { _or: [{ student: { _eq: 'A' } }, { course: { _eq: 'math' } }] };
		expect(pinnedScopedCacheTagsFromFilter('slots', ['student'], filter)).toEqual([]);
	});

	test('an _or unions the fk value for a relational branch', () => {
		const filter = {
			_or: [
				{ owner: { id: { _eq: 'A' } } },
				{ owner: { id: { _in: ['B', 'C'] } } },
			],
		};

		expect(
			pinnedScopedCacheTagsFromFilter('slots', ['owner'], filter, {}, { owner: 'id' }),
		).toEqual([
			{ collection: 'slots', field: 'owner', value: 'A' },
			{ collection: 'slots', field: 'owner', value: 'B' },
			{ collection: 'slots', field: 'owner', value: 'C' },
		]);
	});

	test('a field bound by an outer _and AND every _or branch pins both sources', () => {
		const filter = {
			_and: [
				{ course: { _eq: 'math' } },
				{ _or: [{ student: { _eq: 'A' } }, { student: { _eq: 'B' } }] },
			],
		};

		expect(
			pinnedScopedCacheTagsFromFilter('slots', ['student', 'course'], filter),
		).toEqual([
			{ collection: 'slots', field: 'course', value: 'math' },
			{ collection: 'slots', field: 'student', value: 'A' },
			{ collection: 'slots', field: 'student', value: 'B' },
		]);
	});

	test('an empty _or pins nothing', () => {
		expect(
			pinnedScopedCacheTagsFromFilter('slots', ['student'], { _or: [] }),
		).toEqual([]);
	});

	test('an _or dedups a value bound by more than one branch', () => {
		const filter = {
			_or: [{ student: { _eq: 'A' } }, { student: { _in: ['A', 'B'] } }],
		};

		expect(pinnedScopedCacheTagsFromFilter('slots', ['student'], filter)).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
			{ collection: 'slots', field: 'student', value: 'B' },
		]);
	});

	test(oneLine`
		_and binding the same field twice unions both values — the over-approximation of the
		intersection (student=A AND student=B is empty, but a union over-purges, never stale)
	`, () => {
		const filter = { _and: [{ student: { _eq: 'A' } }, { student: { _eq: 'B' } }] };

		expect(pinnedScopedCacheTagsFromFilter('slots', ['student'], filter)).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
			{ collection: 'slots', field: 'student', value: 'B' },
		]);
	});

	test(oneLine`
		an empty _in bounds the field to no value, so nothing pins — the read stays bare (a
		later insert of any value is caught by the bare collection tag)
	`, () => {
		expect(
			pinnedScopedCacheTagsFromFilter('slots', ['student'], { student: { _in: [] } }),
		).toEqual([]);
	});

	test(oneLine`
		a date-ish scope field is not pin-safe (filter↔row canonical can diverge), so an _eq
		on it yields no pin — the read falls back to the bare collection tag
	`, () => {
		expect(
			pinnedScopedCacheTagsFromFilter(
				'slots',
				['starts_at'],
				{ starts_at: { _eq: '2026-01-01T00:00:00Z' } },
				{ starts_at: 'dateTime' },
			),
		).toEqual([]);
	});

	test('a pin-safe field still pins alongside a skipped date field', () => {
		const filter = {
			_and: [{ student: { _eq: 'A' } }, { starts_at: { _eq: '2026-01-01' } }],
		};

		expect(
			pinnedScopedCacheTagsFromFilter('slots', ['student', 'starts_at'], filter, {
				student: 'string',
				starts_at: 'date',
			}),
		).toEqual([
			{ collection: 'slots', field: 'student', value: 'A', type: 'string' },
		]);
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

	test(oneLine`
		a relation filtered by its related primary key pins the fk value — the relational
		form queries and permission rules use, e.g. { user_created: { id: { _eq } } }
	`, () => {
		expect(
			pinnedScopedCacheTagsFromFilter(
				'slots',
				['student'],
				{ student: { id: { _eq: 'A' } } },
				{},
				{ student: 'id' },
			),
		).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
		]);
	});

	test('a relational _in on the related primary key pins every value', () => {
		expect(
			pinnedScopedCacheTagsFromFilter(
				'slots',
				['student'],
				{ student: { id: { _in: ['A', 'B'] } } },
				{},
				{ student: 'id' },
			),
		).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
			{ collection: 'slots', field: 'student', value: 'B' },
		]);
	});

	test('a relational pin is reached through _and (permission-rule form)', () => {
		const filter = { _and: [{ student: { id: { _eq: 'A' } } }] };

		expect(
			pinnedScopedCacheTagsFromFilter('slots', ['student'], filter, {}, {
				student: 'id',
			}),
		).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
		]);
	});

	test(oneLine`
		a relation filtered by a non-primary-key attribute does not pin — the fk value is
		undetermined, so the read falls back to the bare collection tag
	`, () => {
		expect(
			pinnedScopedCacheTagsFromFilter(
				'slots',
				['student'],
				{ student: { email: { _eq: 'a@b.c' } } },
				{},
				{ student: 'id' },
			),
		).toEqual([]);
	});

	test(oneLine`
		without a related-primary-key entry (a scalar scope field), a relational filter
		shape does not pin
	`, () => {
		expect(
			pinnedScopedCacheTagsFromFilter('slots', ['student'], {
				student: { id: { _eq: 'A' } },
			}),
		).toEqual([]);
	});

	test('a relational pin nested through several _and levels still pins', () => {
		const filter = { _and: [{ _and: [{ student: { id: { _eq: 'A' } } }] }] };

		expect(
			pinnedScopedCacheTagsFromFilter('slots', ['student'], filter, {}, {
				student: 'id',
			}),
		).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
		]);
	});

	test(oneLine`
		a two-hop relation path ({ fk: { rel: { pk: { _eq } } } }) does not pin — it
		bounds the hop, not the fk value, so the read falls back to the bare tag
	`, () => {
		expect(
			pinnedScopedCacheTagsFromFilter(
				'slots',
				['student'],
				{ student: { school: { id: { _eq: 'A' } } } },
				{},
				{ student: 'id' },
			),
		).toEqual([]);
	});

	test('a non-id related primary key is unwrapped by the passed key', () => {
		expect(
			pinnedScopedCacheTagsFromFilter(
				'slots',
				['student'],
				{ student: { code: { _eq: 'A' } } },
				{},
				{ student: 'code' },
			),
		).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
		]);
	});

	test('empty / null filter yields no pin', () => {
		expect(pinnedScopedCacheTagsFromFilter('slots', ['student'], null)).toEqual([]);
		expect(pinnedScopedCacheTagsFromFilter('slots', ['student'], {})).toEqual([]);
	});
});
