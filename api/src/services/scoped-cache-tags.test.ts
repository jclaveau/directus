import { oneLine } from '@directus/utils';
import { describe, expect, test } from 'vitest';
import type { Filter, SchemaOverview } from '@directus/types';
import {
	canonicalScopedCacheValue,
	composeScopedCachePaths,
	pinnedScopedCacheTagsFromFilter,
	scopedCacheTagsFromRows,
	serializeScopedCacheTags,
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

	test(oneLine`
		uuid: an uppercase spelling and a lowercase one collapse — the DB compares uuid
		case-insensitively, so both name the same row and must name one slice
	`, () => {
		const upper = '07D1AF3C-4B4E-4D6E-9C2A-2F1E0B8A5C31';

		expect(canonicalScopedCacheValue(upper, 'uuid'))
			.toBe(canonicalScopedCacheValue(upper.toLowerCase(), 'uuid'));

		expect(canonicalScopedCacheValue(upper, 'uuid')).toBe(upper.toLowerCase());
	});

	test(oneLine`
		integer: a leading zero, a leading plus and a driver number all collapse — the DB
		reads them as one key, so they cannot resolve different slices
	`, () => {
		for (const spelling of [1, '1', '01', '+1', '0001']) {
			expect(canonicalScopedCacheValue(spelling, 'integer')).toBe('1');
		}

		// A signed zero is still zero, and a zero must not be stripped to empty.
		expect(canonicalScopedCacheValue('-0', 'integer')).toBe('0');
		expect(canonicalScopedCacheValue('000', 'integer')).toBe('0');
		expect(canonicalScopedCacheValue('-007', 'integer')).toBe('-7');
	});

	test(oneLine`
		bigInteger: a leading-zero spelling collapses without a numeric pass, so
		precision past MAX_SAFE_INTEGER survives
	`, () => {
		expect(canonicalScopedCacheValue('00009007199254740993', 'bigInteger'))
			.toBe('9007199254740993');
	});

	test(oneLine`
		integer: every spelling \`validateKeys\` lets through collapses — it only asks
		\`Number.isInteger(Number(key))\`, so whitespace, exponent and hex forms reach a
		tag, and postgres trims whitespace casting text to int, so \` 1\` really is row 1
	`, () => {
		for (const spelling of [' 1', '1 ', '1.0']) {
			expect(canonicalScopedCacheValue(spelling, 'integer')).toBe('1');
		}

		expect(canonicalScopedCacheValue('1e3', 'integer')).toBe('1000');
		expect(canonicalScopedCacheValue('0x10', 'integer')).toBe('16');
	});

	test(oneLine`
		a non-numeric value on an integer field keeps its string form rather than
		becoming an empty token
	`, () => {
		expect(canonicalScopedCacheValue('', 'integer')).toBe('');
		expect(canonicalScopedCacheValue('7a', 'integer')).toBe('7a');

		// Not an integer at all: no token can be right, so don't invent one.
		expect(canonicalScopedCacheValue('1.5', 'integer')).toBe('1.5');
	});

	test(oneLine`
		bigInteger past MAX_SAFE_INTEGER keeps its raw spelling — no numeric token can
		round-trip it, and such a key cannot have matched a row either
	`, () => {
		expect(canonicalScopedCacheValue('1e30', 'bigInteger')).toBe('1e30');
	});

	test(oneLine`
		string: spelling is NOT normalized — a varchar key really is a distinct value,
		and the DB would not match the other spelling either
	`, () => {
		expect(canonicalScopedCacheValue('01', 'string')).toBe('01');
		expect(canonicalScopedCacheValue('ABC', 'string')).toBe('ABC');
	});

	test('unknown/undefined type falls back to `String` (owner-id path)', () => {
		expect(canonicalScopedCacheValue(42, undefined)).toBe('42');
		expect(canonicalScopedCacheValue('7c9e-uuid', undefined)).toBe('7c9e-uuid');
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
		an _or whose branches bind DIFFERENT scope fields pins each — the read is purged if a
		write touches either, since every branch covers its own rows
	`, () => {
		const filter = { _or: [{ student: { _eq: 'A' } }, { course: { _eq: 'math' } }] };

		expect(
			pinnedScopedCacheTagsFromFilter('slots', ['student', 'course'], filter),
		).toEqual([
			{ collection: 'slots', field: 'student', value: 'A' },
			{ collection: 'slots', field: 'course', value: 'math' },
		]);
	});

	test(oneLine`
		an _or with one branch binding no pinnable field is bare even when the others bind
		different scope fields — that branch's rows carry no pinned tag
	`, () => {
		const filter = {
			_or: [
				{ student: { _eq: 'A' } },
				{ course: { _eq: 'math' } },
				{ note: { _contains: 'x' } },
			],
		};

		expect(
			pinnedScopedCacheTagsFromFilter('slots', ['student', 'course'], filter),
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

// The primary key is a pinning axis on every collection, taking no config and no
// query: `readOne` bounds the read to one key, and only that row's own write can
// change it. An inserted row carries a different key, so the insert-blindness that
// bars a value slice elsewhere cannot apply here.
describe('pinnedScopedCacheTagsFromFilter — implicit primary key', () => {
	// `slots` declares no scope field here: the pin comes from the key alone.
	const unscoped = (filter: Filter) => {
		return pinnedScopedCacheTagsFromFilter(
			'slots',
			[],
			filter,
			{ id: 'integer' },
			{},
			[],
			'id',
		);
	};

	test('_eq on the primary key pins that row, with no scope field declared', () => {
		expect(unscoped({ id: { _eq: 7 } })).toEqual([
			{ collection: 'slots', field: 'id', value: 7, type: 'integer' },
		]);
	});

	test('_in on the primary key pins every listed key (the readMany shape)', () => {
		expect(unscoped({ _and: [{ id: { _in: [7, 8] } }, {}] })).toEqual([
			{ collection: 'slots', field: 'id', value: 7, type: 'integer' },
			{ collection: 'slots', field: 'id', value: 8, type: 'integer' },
		]);
	});

	test(oneLine`
		a filter leaving the key unbound still pins nothing — a list read has no key to
		pin, so it stays on the bare collection tag
	`, () => {
		expect(unscoped({ name: { _eq: 'a' } })).toEqual([]);
		expect(unscoped({ id: { _gt: 7 } })).toEqual([]);
		expect(unscoped({})).toEqual([]);
	});

	test(oneLine`
		an _or branch that leaves the key unbound drops the pin — a row matching that
		branch carries a key outside the union
	`, () => {
		const filter = { _or: [{ id: { _eq: 7 } }, { name: { _eq: 'a' } }] };
		expect(unscoped(filter)).toEqual([]);
	});

	test(oneLine`
		the key pins alongside a declared scope field bound by the same filter
	`, () => {
		const filter = { _and: [{ id: { _eq: 7 } }, { student: { _eq: 'A' } }] };

		expect(
			pinnedScopedCacheTagsFromFilter(
				'slots',
				['student'],
				filter,
				{ id: 'integer', student: 'string' },
				{},
				[],
				'id',
			),
		).toEqual([
			{ collection: 'slots', field: 'id', value: 7, type: 'integer' },
			{ collection: 'slots', field: 'student', value: 'A', type: 'string' },
		]);
	});

	test(oneLine`
		a project that also lists its key as a scope field gets one tag, not two — the
		purge side dedups its projection for the same reason
	`, () => {
		expect(
			pinnedScopedCacheTagsFromFilter(
				'slots',
				['id'],
				{ id: { _eq: 7 } },
				{ id: 'integer' },
				{},
				[],
				'id',
			),
		).toEqual([
			{ collection: 'slots', field: 'id', value: 7, type: 'integer' },
		]);
	});

	test(oneLine`
		a caller passing no primary key pins nothing on an unscoped collection — the axis
		reaches only callers that opt in, so no other pinner gains it silently
	`, () => {
		expect(
			pinnedScopedCacheTagsFromFilter('slots', [], { id: { _eq: 7 } }),
		).toEqual([]);
	});

	test(oneLine`
		read↔purge symmetry on a uuid key: the URL's uppercase spelling and the driver's
		lowercase row resolve ONE slice, or a write never purges the read it changed
	`, () => {
		const upper = '07D1AF3C-4B4E-4D6E-9C2A-2F1E0B8A5C31';

		const pinned = pinnedScopedCacheTagsFromFilter(
			'notes',
			[],
			{ id: { _eq: upper } },
			{ id: 'uuid' },
			{},
			[],
			'id',
		);

		const purged = scopedCacheTagsFromRows(
			'notes',
			['id'],
			[{ id: upper.toLowerCase() }],
			'coarse',
			{ id: 'uuid' },
		);

		expect(serializeScopedCacheTags(pinned))
			.toBe(serializeScopedCacheTags(purged ?? []));
	});

	test(oneLine`
		read↔purge symmetry on an integer key: a padded URL key and the driver's number
		resolve ONE slice
	`, () => {
		const pinned = pinnedScopedCacheTagsFromFilter(
			'notes',
			[],
			{ id: { _eq: '007' } },
			{ id: 'integer' },
			{},
			[],
			'id',
		);

		const purged = scopedCacheTagsFromRows(
			'notes',
			['id'],
			[{ id: 7 }],
			'coarse',
			{ id: 'integer' },
		);

		expect(serializeScopedCacheTags(pinned))
			.toBe(serializeScopedCacheTags(purged ?? []));
	});

	test(oneLine`
		a date-typed key is refused like any other unpinnable type — it goes through the
		same PIN_UNSAFE_SCOPE_TYPES gate
	`, () => {
		expect(
			pinnedScopedCacheTagsFromFilter(
				'slots',
				[],
				{ stamped_at: { _eq: '2026-01-02T03:04:05.000Z' } },
				{ stamped_at: 'dateTime' },
				{},
				[],
				'stamped_at',
			),
		).toEqual([]);
	});
});

describe('pinnedScopedCacheTagsFromFilter — relational paths (multi-hop)', () => {
	const enrollmentPath = [
		{
			field: 'enrollment.student.user',
			segments: ['enrollment', 'student', 'user'],
		},
	];

	test('pins the terminal _eq of a two-hop path (was bare before)', () => {
		const filter = { enrollment: { student: { _eq: 'S1' } } };

		const paths = [
			{ field: 'enrollment.student', segments: ['enrollment', 'student'] },
		];

		expect(
			pinnedScopedCacheTagsFromFilter('disc', [], filter, {}, {}, paths),
		).toEqual([
			{ collection: 'disc', field: 'enrollment.student', value: 'S1' },
		]);
	});

	test('pins the terminal _eq of a three-hop path', () => {
		const filter = { enrollment: { student: { user: { _eq: 'U1' } } } };

		expect(
			pinnedScopedCacheTagsFromFilter('disc', [], filter, {}, {}, enrollmentPath),
		).toEqual([
			{ collection: 'disc', field: 'enrollment.student.user', value: 'U1' },
		]);
	});

	test('pins the terminal _in of a path', () => {
		const filter = { enrollment: { student: { user: { _in: ['U1', 'U2'] } } } };

		expect(
			pinnedScopedCacheTagsFromFilter('disc', [], filter, {}, {}, enrollmentPath),
		).toEqual([
			{ collection: 'disc', field: 'enrollment.student.user', value: 'U1' },
			{ collection: 'disc', field: 'enrollment.student.user', value: 'U2' },
		]);
	});

	test('unwraps a PK-nested terminal (`user: { id: { _eq } }`)', () => {
		const filter = { enrollment: { student: { user: { id: { _eq: 'U1' } } } } };

		expect(
			pinnedScopedCacheTagsFromFilter(
				'disc',
				[],
				filter,
				{},
				{ 'enrollment.student.user': 'id' },
				enrollmentPath,
			),
		).toEqual([
			{ collection: 'disc', field: 'enrollment.student.user', value: 'U1' },
		]);
	});

	test('a filter that stops short of the terminal does not pin (bare)', () => {
		const filter = { enrollment: { student: { _eq: 'S1' } } };

		expect(
			pinnedScopedCacheTagsFromFilter('disc', [], filter, {}, {}, enrollmentPath),
		).toEqual([]);
	});

	test('a non-eq terminal op (`_gt`) does not bound the path', () => {
		const filter = { enrollment: { student: { user: { _gt: 'U1' } } } };

		expect(
			pinnedScopedCacheTagsFromFilter('disc', [], filter, {}, {}, enrollmentPath),
		).toEqual([]);
	});

	test('a pin-unsafe terminal type (dateTime) falls back to bare', () => {
		const filter = { enrollment: { student: { joined_at: { _eq: '2026-01-01' } } } };

		const paths = [
			{
				field: 'enrollment.student.joined_at',
				segments: ['enrollment', 'student', 'joined_at'],
			},
		];

		expect(
			pinnedScopedCacheTagsFromFilter(
				'disc',
				[],
				filter,
				{ 'enrollment.student.joined_at': 'dateTime' },
				{},
				paths,
			),
		).toEqual([]);
	});

	test('a path inside an _or pins when the branch binds it, unioned', () => {
		const filter = {
			_or: [
				{ enrollment: { student: { user: { _eq: 'U1' } } } },
				{ enrollment: { student: { user: { _eq: 'U2' } } } },
			],
		};

		expect(
			pinnedScopedCacheTagsFromFilter('disc', [], filter, {}, {}, enrollmentPath),
		).toEqual([
			{ collection: 'disc', field: 'enrollment.student.user', value: 'U1' },
			{ collection: 'disc', field: 'enrollment.student.user', value: 'U2' },
		]);
	});

	test('a path and a flat field both pin from one filter', () => {
		const filter = {
			term: { _eq: 'fall' },
			enrollment: { student: { user: { _eq: 'U1' } } },
		};

		expect(
			pinnedScopedCacheTagsFromFilter(
				'disc',
				['term'],
				filter,
				{},
				{},
				enrollmentPath,
			),
		).toEqual([
			{ collection: 'disc', field: 'term', value: 'fall' },
			{ collection: 'disc', field: 'enrollment.student.user', value: 'U1' },
		]);
	});
});

// The dev-only `X-Scoped-Cache-*` headers render tags as their key suffix (no
// namespace prefix), via canonicalScopedCacheValue so it matches the tag key.
describe('serializeScopedCacheTags', () => {
	test(oneLine`
		a bare tag (no field) renders as just the collection
	`, () => {
		expect(
			serializeScopedCacheTags([{ collection: 'article' }]),
		).toBe('article');
	});

	test(oneLine`
		a pinned slice renders as collection:field=value
	`, () => {
		expect(
			serializeScopedCacheTags([
				{ collection: 'article', field: 'author', value: 'U1' },
			]),
		).toBe('article:author=U1');
	});

	test(oneLine`
		the value is canonicalized like the tag key (boolean 1 collapses to true)
	`, () => {
		expect(
			serializeScopedCacheTags([
				{ collection: 'a', field: 'live', value: 1, type: 'boolean' },
			]),
		).toBe('a:live=true');
	});

	test(oneLine`
		multiple tags join with ", " and mix bare + sliced
	`, () => {
		expect(
			serializeScopedCacheTags([
				{ collection: 'article', field: 'author', value: 'U1' },
				{ collection: 'banner' },
			]),
		).toBe('article:author=U1, banner');
	});

	test(oneLine`
		an empty tag list renders as an empty string
	`, () => {
		expect(serializeScopedCacheTags([])).toBe('');
	});
});

describe('composeScopedCachePaths — auto-derived multi-hop paths', () => {
	// Minimal schema: each collection's local scope fields + the M2O relations.
	function schemaOf(
		scoped: Record<string, string[]>,
		relations: { collection: string; field: string; related_collection: string }[],
	): Pick<SchemaOverview, 'collections' | 'relations'> {
		const collections = Object.fromEntries(
			Object.entries(scoped).map(([name, scopedCacheFields]) => {
				return [name, { scopedCacheFields }];
			}),
		);

		return { collections, relations } as unknown as Pick<
			SchemaOverview,
			'collections' | 'relations'
		>;
	}

	test('composes a 2-hop grand-owner path from two local declarations', () => {
		const schema = schemaOf(
			{ sub: ['item'], item: ['owner_ref'] },
			[
				{ collection: 'sub', field: 'item', related_collection: 'item' },
				{ collection: 'item', field: 'owner_ref', related_collection: 'owner' },
			],
		);

		expect(composeScopedCachePaths(schema, 'sub')).toEqual([
			{ field: 'item.owner_ref', segments: ['item', 'owner_ref'] },
		]);
	});

	test('composes every level of a 3-hop chain', () => {
		const schema = schemaOf(
			{ a: ['b'], b: ['c'], c: ['owner_ref'] },
			[
				{ collection: 'a', field: 'b', related_collection: 'b' },
				{ collection: 'b', field: 'c', related_collection: 'c' },
				{ collection: 'c', field: 'owner_ref', related_collection: 'owner' },
			],
		);

		expect(composeScopedCachePaths(schema, 'a')).toEqual([
			{ field: 'b.c', segments: ['b', 'c'] },
			{ field: 'b.c.owner_ref', segments: ['b', 'c', 'owner_ref'] },
		]);
	});

	test('composes both arms of a diamond to the same owner', () => {
		const schema = schemaOf(
			{ a: ['x', 'y'], x_col: ['owner_ref'], y_col: ['owner_ref'] },
			[
				{ collection: 'a', field: 'x', related_collection: 'x_col' },
				{ collection: 'a', field: 'y', related_collection: 'y_col' },
				{ collection: 'x_col', field: 'owner_ref', related_collection: 'owner' },
				{ collection: 'y_col', field: 'owner_ref', related_collection: 'owner' },
			],
		);

		expect(composeScopedCachePaths(schema, 'a')).toEqual([
			{ field: 'x.owner_ref', segments: ['x', 'owner_ref'] },
			{ field: 'y.owner_ref', segments: ['y', 'owner_ref'] },
		]);
	});

	test('terminates on a self/mutual reference cycle', () => {
		const schema = schemaOf(
			{ a: ['b'], b: ['a'] },
			[
				{ collection: 'a', field: 'b', related_collection: 'b' },
				{ collection: 'b', field: 'a', related_collection: 'a' },
			],
		);

		expect(composeScopedCachePaths(schema, 'a')).toEqual([
			{ field: 'b.a', segments: ['b', 'a'] },
			{ field: 'b.a.b', segments: ['b', 'a', 'b'] },
		]);
	});

	test('a scalar scope field composes nothing (no relation to follow)', () => {
		const schema = schemaOf({ a: ['name'] }, []);
		expect(composeScopedCachePaths(schema, 'a')).toEqual([]);
	});

	test('a target with no scope fields composes nothing', () => {
		const schema = schemaOf(
			{ a: ['owner_ref'] },
			[{ collection: 'a', field: 'owner_ref', related_collection: 'owner' }],
		);

		expect(composeScopedCachePaths(schema, 'a')).toEqual([]);
	});

	test('an explicit dotted local field is not used as a compose head', () => {
		const schema = schemaOf(
			{ a: ['owned_item.owner_ref'] },
			[{ collection: 'a', field: 'owned_item', related_collection: 'owned_item' }],
		);

		expect(composeScopedCachePaths(schema, 'a')).toEqual([]);
	});
});
