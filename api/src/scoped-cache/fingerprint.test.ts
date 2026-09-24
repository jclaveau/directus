import { oneLine } from '@directus/utils';
import { describe, expect, it } from 'vitest';
import {
	parseScopedCacheFingerprint,
	renderScopedCacheFingerprint,
	scopedCacheViewFieldsAreTouched,
	scopedCacheFingerprintIsBare,
	scopedCacheFingerprintOf,
	scopedCacheFingerprintsByCollection,
	scopedCacheFingerprintMatchesRow,
	scopedCacheFingerprintPurgedBy,
} from './fingerprint.js';

describe('renderScopedCacheFingerprint', () => {
	it('sorts the pins and wraps every value in commas', () => {
		expect(renderScopedCacheFingerprint({
			collection: 'student_time_slot',
			pinnedScope: { user: ['A'], course_part: ['4821'] },
			viewFields: ['course_part', 'day', 'id'],
		})).toBe(
			'student_time_slot:&course_part=,4821,&user=,A,'
			+ '&view=,course_part,day,id,&',
		);
	});

	// The `*` of a read bound to every field is escaped like any other token: a
	// field cannot be named `*`, so nothing is lost, and the escape rule stays one
	// rule rather than one rule and an exception a pattern would have to know.
	it('lists a multi-valued pin once, sorted and deduped', () => {
		expect(renderScopedCacheFingerprint({
			collection: 'student_time_slot',
			pinnedScope: { course_part: ['2', '1', '2'] },
			viewFields: ['*'],
		})).toBe('student_time_slot:&course_part=,1,2,&view=,\\*,&');
	});

	it('leaves out the view pin when the read names none', () => {
		expect(renderScopedCacheFingerprint({
			collection: 'student_time_slot',
			pinnedScope: { user: ['A'] },
		})).toBe('student_time_slot:&user=,A,&');
	});

	it('renders a collection bound to nothing', () => {
		expect(renderScopedCacheFingerprint(
			{ collection: 'student_time_slot' },
		)).toBe('student_time_slot:&');
	});

	it('renders an empty pinned scope the way it renders an absent one', () => {
		expect(renderScopedCacheFingerprint(
			{ collection: 'student_time_slot', pinnedScope: {}, viewFields: [] },
		)).toBe('student_time_slot:&');
	});

	it('escapes a value carrying a separator', () => {
		expect(renderScopedCacheFingerprint({
			collection: 'note',
			pinnedScope: { title: ['a,b&c|d\\e'] },
		})).toBe('note:&title=,a\\,b\\&c\\|d\\\\e,&');
	});

	// A raw one would make the pattern a purge builds around this value match
	// slices the value never named, which is a purge of somebody else's entries.
	it('escapes a value carrying a glob metacharacter', () => {
		expect(renderScopedCacheFingerprint({
			collection: 'note',
			pinnedScope: { title: ['a*b?c[d]'] },
		})).toBe('note:&title=,a\\*b\\?c\\[d\\],&');
	});
});

describe('parseScopedCacheFingerprint', () => {
	it('reads the collection, the scope and the fields back', () => {
		const parsed = parseScopedCacheFingerprint(
			'student_time_slot:&course_part=,1,2,&user=,A,&view=,day,id,&',
		);

		expect(parsed.collection).toBe('student_time_slot');

		expect(parsed.pinnedScope).toEqual({
			course_part: ['1', '2'],
			user: ['A'],
		});

		expect(parsed.viewFields).toEqual(['day', 'id']);
	});

	it('unescapes a value carrying a separator', () => {
		expect(parseScopedCacheFingerprint(
			'note:&title=,a\\,b\\&c\\|d\\\\e,&',
		).pinnedScope).toEqual({ title: ['a,b&c|d\\e'] });
	});

	it('unescapes a value carrying a glob metacharacter', () => {
		expect(parseScopedCacheFingerprint(
			'note:&title=,a\\*b\\?c\\[d\\],&',
		).pinnedScope).toEqual({ title: ['a*b?c[d]'] });
	});

	it('reads back a collection bound to nothing', () => {
		const parsed = parseScopedCacheFingerprint('student_time_slot:&');

		expect(parsed.collection).toBe('student_time_slot');
		expect(parsed.pinnedScope).toBeUndefined();
		expect(parsed.viewFields).toBeUndefined();
	});

	it('reads back a field named after an object member', () => {
		const parsed = parseScopedCacheFingerprint(
			'slot:&__proto__=,alpha,&constructor=,beta,&',
		);

		// Read through `entries`, since `{ __proto__: … }` in the expectation would
		// set the prototype rather than declare the key under test.
		expect(Object.entries(parsed.pinnedScope ?? {})).toEqual([
			['__proto__', ['alpha']],
			['constructor', ['beta']],
		]);
	});

	it('reads back a value whose escapes only look like two values', () => {
		expect(parseScopedCacheFingerprint(
			renderScopedCacheFingerprint(
				{ collection: 'slot', pinnedScope: { owner: ['a,b'] } },
			),
		).pinnedScope).toEqual({ owner: ['a,b'] });
	});
});

describe('scopedCacheFingerprintOf', () => {
	it('folds two pins on one field into one', () => {
		expect(scopedCacheFingerprintOf(
			'note',
			[
				{ field: 'owner', value: 'a', type: 'string' },
				{ field: 'owner', value: 'b', type: 'string' },
				{ field: 'id', value: 7, type: 'integer' },
			],
			['*'],
		)).toEqual({
			collection: 'note',
			pinnedScope: { owner: ['a', 'b'], id: ['7'] },
			viewFields: ['*'],
		});
	});

	it('canonicalizes each value the way the tag key does', () => {
		expect(scopedCacheFingerprintOf(
			'note',
			[
				{ field: 'id', value: '007', type: 'integer' },
				{ field: 'flag', value: 't', type: 'boolean' },
			],
		)).toEqual({
			collection: 'note',
			pinnedScope: { id: ['7'], flag: ['true'] },
		});
	});

	it('pins a field named after an object member', () => {
		expect(renderScopedCacheFingerprint(scopedCacheFingerprintOf(
			'note',
			[{ field: '__proto__', value: 'a', type: 'string' }],
		))).toBe('note:&__proto__=,a,&');
	});

	it('drops a pin naming no field, which pins nothing', () => {
		expect(scopedCacheFingerprintOf('note', [{}]))
			.toEqual({ collection: 'note' });
	});
});

describe('scopedCacheFingerprintIsBare', () => {
	it('reads a fingerprint naming only its collection as bare', () => {
		expect(scopedCacheFingerprintIsBare({ collection: 'note' })).toBe(true);
	});

	it('reads an empty pinned scope as bare', () => {
		expect(scopedCacheFingerprintIsBare(
			{ collection: 'note', pinnedScope: {}, viewFields: [] },
		)).toBe(true);
	});

	it('reads a fingerprint pinning a field as not bare', () => {
		expect(scopedCacheFingerprintIsBare(
			{ collection: 'note', pinnedScope: { user: ['A'] } },
		)).toBe(false);
	});

	it('reads a fingerprint naming view fields and no pin as bare', () => {
		expect(scopedCacheFingerprintIsBare(
			{ collection: 'note', viewFields: ['title'] },
		)).toBe(true);
	});
});

describe('scopedCacheFingerprintMatchesRow', () => {
	const row = parseScopedCacheFingerprint(
		'slot:&id=,913,&method=,spaced,&owner=,alpha,&',
	);

	it('matches a row satisfying every pin', () => {
		expect(scopedCacheFingerprintMatchesRow(
			parseScopedCacheFingerprint('slot:&method=,spaced,&owner=,alpha,&view=,*,&'),
			row,
		)).toBe(true);
	});

	it('refuses a row satisfying one pin but not the other', () => {
		expect(scopedCacheFingerprintMatchesRow(
			parseScopedCacheFingerprint('slot:&method=,spaced,&owner=,beta,&view=,*,&'),
			row,
		)).toBe(false);
	});

	it('matches a row on any value of a multi-valued pin', () => {
		expect(scopedCacheFingerprintMatchesRow(
			parseScopedCacheFingerprint('slot:&owner=,alpha,beta,&'),
			row,
		)).toBe(true);
	});

	it('matches every row when the fingerprint pins nothing', () => {
		expect(scopedCacheFingerprintMatchesRow(
			parseScopedCacheFingerprint('slot:&view=,*,&'),
			row,
		)).toBe(true);
	});

	it('refuses a row whose value merely starts with the pinned one', () => {
		expect(scopedCacheFingerprintMatchesRow(
			parseScopedCacheFingerprint('slot:&owner=,alph,&'),
			row,
		)).toBe(false);
	});

	it('refuses a row carrying no pin of that name at all', () => {
		expect(scopedCacheFingerprintMatchesRow(
			parseScopedCacheFingerprint('slot:&ner=,alpha,&'),
			row,
		)).toBe(false);
	});

	it('matches a value carrying a separator', () => {
		expect(scopedCacheFingerprintMatchesRow(
			{ collection: 'slot', pinnedScope: { owner: ['a,b'] } },
			{ collection: 'slot', pinnedScope: { owner: ['a,b'] } },
		)).toBe(true);
	});

	it('refuses a row whose value only looks like the pinned one', () => {
		expect(scopedCacheFingerprintMatchesRow(
			{ collection: 'slot', pinnedScope: { owner: ['a'] } },
			{ collection: 'slot', pinnedScope: { owner: ['a,b'] } },
		)).toBe(false);
	});

	// Nothing forbids a collection a column named after an Object member, and the
	// scope is keyed by column name.
	it('refuses a row carrying no pin named after an object member', () => {
		expect(scopedCacheFingerprintMatchesRow(
			parseScopedCacheFingerprint('slot:&constructor=,alpha,&'),
			row,
		)).toBe(false);
	});

	it('matches a row on a pin named after an object member', () => {
		expect(scopedCacheFingerprintMatchesRow(
			parseScopedCacheFingerprint('slot:&constructor=,alpha,&'),
			parseScopedCacheFingerprint('slot:&constructor=,alpha,&'),
		)).toBe(true);
	});

	it('matches a row on a pin named `__proto__`', () => {
		expect(scopedCacheFingerprintMatchesRow(
			parseScopedCacheFingerprint('slot:&__proto__=,alpha,&'),
			parseScopedCacheFingerprint('slot:&__proto__=,alpha,&'),
		)).toBe(true);
	});

	it('refuses a row whose pin named `__proto__` holds another value', () => {
		expect(scopedCacheFingerprintMatchesRow(
			parseScopedCacheFingerprint('slot:&__proto__=,alpha,&'),
			parseScopedCacheFingerprint('slot:&__proto__=,beta,&'),
		)).toBe(false);
	});
});

describe('scopedCacheViewFieldsAreTouched', () => {
	it('is touched by an insert or a delete, whichever fields it names', () => {
		expect(scopedCacheViewFieldsAreTouched(['id'], null)).toBe(true);
	});

	it('is touched by any column when the read selected every one', () => {
		expect(scopedCacheViewFieldsAreTouched(['*'], ['note'])).toBe(true);
	});

	it('is touched by a column it names', () => {
		expect(scopedCacheViewFieldsAreTouched(['id', 'day'], ['day']))
			.toBe(true);
	});

	it('is left alone by a column it never named', () => {
		expect(scopedCacheViewFieldsAreTouched(['id', 'day'], ['note']))
			.toBe(false);
	});

	it('is touched by a nested change under a wildcard it names', () => {
		expect(scopedCacheViewFieldsAreTouched(
			['method_range.*'],
			['method_range.method'],
		)).toBe(true);
	});

	it('is left alone by a nested change under the fk column alone', () => {
		expect(scopedCacheViewFieldsAreTouched(
			['method_range'],
			['method_range.method'],
		)).toBe(false);
	});

	it('is touched when a read naming no field at all meets any write', () => {
		expect(scopedCacheViewFieldsAreTouched([], ['note'])).toBe(true);
	});
});

describe('scopedCacheFingerprintsByCollection', () => {
	it(oneLine`
		folds one query case's pins into one fingerprint, and each collection into its
		own
	`, () => {
		expect(scopedCacheFingerprintsByCollection(
			[
				[
					{ collection: 'slot', field: 'owner', value: 'alpha' },
					{ collection: 'slot', field: 'method', value: 'spaced' },
				],
				[{ collection: 'zone', field: 'area', value: 'north' }],
			],
			new Map([['slot', ['id', 'owner']], ['zone', ['area']]]),
		).map(renderScopedCacheFingerprint)).toEqual([
			'slot:&method=,spaced,&owner=,alpha,&view=,id,owner,&',
			'zone:&area=,north,&view=,area,&',
		]);
	});

	// The `_or` across two fields: a row matching either changes the response, so
	// each way is its own fingerprint. One fingerprint holding both pins would
	// match a row carrying both and nothing else.
	it('renders one fingerprint per way the read matches a collection', () => {
		expect(scopedCacheFingerprintsByCollection(
			[
				[{ collection: 'slot', field: 'owner', value: 'alpha' }],
				[{ collection: 'slot', field: 'dept', value: 'rh' }],
			],
			new Map([['slot', ['id']]]),
		).map(renderScopedCacheFingerprint)).toEqual([
			'slot:&owner=,alpha,&view=,id,&',
			'slot:&dept=,rh,&view=,id,&',
		]);
	});

	it('renders a bare tag as a fingerprint pinning nothing but its fields', () => {
		expect(scopedCacheFingerprintsByCollection(
			[[{ collection: 'slot' }]],
			new Map([['slot', ['id', 'note']]]),
		).map(renderScopedCacheFingerprint)).toEqual(['slot:&view=,id,note,&']);
	});

	it(oneLine`
		renders a collection whose fields are unknown as one any write matches
	`, () => {
		expect(scopedCacheFingerprintsByCollection([[{ collection: 'slot' }]])
			.map(renderScopedCacheFingerprint)).toEqual(['slot:&']);
	});

	it('carries the same query case once, however many times it is named', () => {
		expect(scopedCacheFingerprintsByCollection([
			[{ collection: 'slot', field: 'owner', value: 'alpha' }],
			[{ collection: 'slot', field: 'owner', value: 'alpha' }],
		]).map(renderScopedCacheFingerprint)).toEqual(['slot:&owner=,alpha,&']);
	});
});

describe('scopedCacheFingerprintPurgedBy', () => {
	const read = parseScopedCacheFingerprint(
		'slot:&method=,spaced,&owner=,alpha,&view=,id,owner,&',
	);

	it('purges when the row satisfies every pin and a bound field changed', () => {
		expect(scopedCacheFingerprintPurgedBy(
			read,
			[parseScopedCacheFingerprint('slot:&id=,1,&method=,spaced,&owner=,alpha,&')],
			['owner'],
		)).toBe(true);
	});

	it(oneLine`
		leaves the read alone when the row satisfies one pin but not the other
	`, () => {
		expect(scopedCacheFingerprintPurgedBy(
			read,
			[parseScopedCacheFingerprint('slot:&id=,1,&method=,spaced,&owner=,beta,&')],
			['owner'],
		)).toBe(false);
	});

	it('leaves the read alone when the write changed no field it is bound to', () => {
		expect(scopedCacheFingerprintPurgedBy(
			read,
			[parseScopedCacheFingerprint('slot:&id=,1,&method=,spaced,&owner=,alpha,&')],
			['note'],
		)).toBe(false);
	});

	// A pinned field is bound whether or not the read also selected it: the row
	// crossing it enters or leaves the result set, which is a changed response by
	// itself. This is how a read sliced by a path — `course:&tu.owner.user=,7,&` —
	// survives a write that only rewrote the fk that path runs through.
	it('purges on a pinned field the read never selected', () => {
		expect(scopedCacheFingerprintPurgedBy(
			parseScopedCacheFingerprint('course:&tu.owner.user=,7,&view=,id,name,&'),
			[parseScopedCacheFingerprint('course:&id=,1,&tu.owner.user=,7,&')],
			['tu', 'tu.owner.user'],
		)).toBe(true);
	});

	it('purges on an insert, whichever columns the row carries', () => {
		expect(scopedCacheFingerprintPurgedBy(
			read,
			[parseScopedCacheFingerprint('slot:&id=,1,&method=,spaced,&owner=,alpha,&')],
			null,
		)).toBe(true);
	});

	it(oneLine`
		purges on the row as it became, so a row moving into the read's slice drops
		it
	`, () => {
		expect(scopedCacheFingerprintPurgedBy(
			read,
			[
				parseScopedCacheFingerprint('slot:&id=,1,&method=,spaced,&owner=,beta,&'),
				parseScopedCacheFingerprint('slot:&id=,1,&method=,spaced,&owner=,alpha,&'),
			],
			['owner'],
		)).toBe(true);
	});

	it(oneLine`
		purges on the row as it was, so a row moving out of the read's slice drops it
	`, () => {
		expect(scopedCacheFingerprintPurgedBy(
			read,
			[
				parseScopedCacheFingerprint('slot:&id=,1,&method=,spaced,&owner=,alpha,&'),
				parseScopedCacheFingerprint('slot:&id=,1,&method=,spaced,&owner=,sigma,&'),
			],
			['owner'],
		)).toBe(true);
	});

	it(oneLine`
		leaves the read alone when no row of the batch satisfies its query case
	`, () => {
		expect(scopedCacheFingerprintPurgedBy(
			read,
			[
				parseScopedCacheFingerprint('slot:&id=,1,&method=,massed,&owner=,alpha,&'),
				parseScopedCacheFingerprint('slot:&id=,2,&method=,spaced,&owner=,beta,&'),
			],
			null,
		)).toBe(false);
	});

	it('purges a read pinning nothing on any write to its collection', () => {
		expect(scopedCacheFingerprintPurgedBy(
			parseScopedCacheFingerprint('slot:&'),
			[parseScopedCacheFingerprint('slot:&id=,1,&owner=,beta,&')],
			['note'],
		)).toBe(true);
	});

	it('purges a read bounded to a list of owners by a write to either', () => {
		expect(scopedCacheFingerprintPurgedBy(
			parseScopedCacheFingerprint('slot:&owner=,kappa,lambda,&view=,id,owner,&'),
			[parseScopedCacheFingerprint('slot:&id=,1,&owner=,lambda,&')],
			['owner'],
		)).toBe(true);
	});

	it(oneLine`
		leaves a read bounded to a list of owners alone for a write outside it
	`, () => {
		expect(scopedCacheFingerprintPurgedBy(
			parseScopedCacheFingerprint('slot:&owner=,mu,nu,&view=,id,owner,&'),
			[parseScopedCacheFingerprint('slot:&id=,1,&owner=,xi,&')],
			['owner'],
		)).toBe(false);
	});

	it('purges a read of every field on a change to any column', () => {
		expect(scopedCacheFingerprintPurgedBy(
			parseScopedCacheFingerprint('slot:&owner=,zeta,&view=,*,&'),
			[parseScopedCacheFingerprint('slot:&id=,1,&owner=,zeta,&')],
			['note'],
		)).toBe(true);
	});
});

