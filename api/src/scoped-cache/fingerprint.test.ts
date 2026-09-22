import { oneLine } from '@directus/utils';
import { describe, expect, it } from 'vitest';
import {
	parseScopedCacheFingerprint,
	renderScopedCacheFingerprint,
	scopedCacheFingerprintCollection,
	scopedCacheFingerprintFieldsTouched,
	scopedCacheFingerprintFromTags,
	scopedCacheFingerprintsByCollection,
	scopedCacheFingerprintLabels,
	scopedCacheFingerprintMatchesRow,
	scopedCacheFingerprintPurgedBy,
} from './fingerprint.js';

describe('renderScopedCacheFingerprint', () => {
	it('sorts the pairs and wraps every value in commas', () => {
		expect(renderScopedCacheFingerprint(
			'student_time_slot',
			new Map([['user', ['A']], ['course_part', ['4821']]]),
			['course_part', 'day', 'id'],
		)).toBe(
			'student_time_slot:&course_part=,4821,&fields=,course_part,day,id,'
			+ '&user=,A,&',
		);
	});

	it('lists a multi-valued pair once, sorted and deduped', () => {
		expect(renderScopedCacheFingerprint(
			'student_time_slot',
			new Map([['course_part', ['2', '1', '2']]]),
			['*'],
		)).toBe('student_time_slot:&course_part=,1,2,&fields=,*,&');
	});

	it('leaves out the fields pair when the caller names none', () => {
		expect(renderScopedCacheFingerprint(
			'student_time_slot',
			new Map([['user', ['A']]]),
		)).toBe('student_time_slot:&user=,A,&');
	});

	it('renders a collection bound to nothing', () => {
		expect(renderScopedCacheFingerprint('student_time_slot', new Map()))
			.toBe('student_time_slot:&');
	});

	it('escapes a value carrying a separator', () => {
		expect(renderScopedCacheFingerprint(
			'note',
			new Map([['title', ['a,b&c|d\\e']]]),
		)).toBe('note:&title=,a\\,b\\&c\\|d\\\\e,&');
	});
});

describe('parseScopedCacheFingerprint', () => {
	it('reads the collection, the pairs and the fields back', () => {
		const parsed = parseScopedCacheFingerprint(
			'student_time_slot:&course_part=,1,2,&fields=,day,id,&user=,A,&',
		);

		expect(parsed.collection).toBe('student_time_slot');

		expect([...parsed.pairs]).toEqual([
			['course_part', ['1', '2']],
			['user', ['A']],
		]);

		expect(parsed.fields).toEqual(['day', 'id']);
	});

	it('unescapes a value carrying a separator', () => {
		expect([...parseScopedCacheFingerprint(
			'note:&title=,a\\,b\\&c\\|d\\\\e,&',
		).pairs]).toEqual([['title', ['a,b&c|d\\e']]]);
	});

	it('reads back a collection bound to nothing', () => {
		const parsed = parseScopedCacheFingerprint('student_time_slot:&');

		expect(parsed.collection).toBe('student_time_slot');
		expect([...parsed.pairs]).toEqual([]);
		expect(parsed.fields).toEqual([]);
	});
});

describe('scopedCacheFingerprintCollection', () => {
	it('reads the collection without parsing the pairs', () => {
		expect(scopedCacheFingerprintCollection('note:&id=,1,&'))
			.toBe('note');
	});
});

describe('scopedCacheFingerprintFromTags', () => {
	it('folds two tags on one field into one pair', () => {
		expect(scopedCacheFingerprintFromTags(
			'note',
			[
				{ collection: 'note', field: 'owner', value: 'a', type: 'string' },
				{ collection: 'note', field: 'owner', value: 'b', type: 'string' },
				{ collection: 'note', field: 'id', value: 7, type: 'integer' },
			],
			['*'],
		)).toBe('note:&fields=,*,&id=,7,&owner=,a,b,&');
	});

	it('canonicalizes each value the way the tag key does', () => {
		expect(scopedCacheFingerprintFromTags(
			'note',
			[
				{ collection: 'note', field: 'id', value: '007', type: 'integer' },
				{ collection: 'note', field: 'flag', value: 't', type: 'boolean' },
			],
		)).toBe('note:&flag=,true,&id=,7,&');
	});

	it('drops a bare tag, which pins nothing', () => {
		expect(scopedCacheFingerprintFromTags('note', [{ collection: 'note' }]))
			.toBe('note:&');
	});
});

describe('scopedCacheFingerprintLabels', () => {
	it('renders one legacy label per value, without the fields pair', () => {
		expect(scopedCacheFingerprintLabels(
			'entry:&account=,7,&account.org=,3,&account.org.owner=,acme,'
			+ '&fields=,*,&id=,913,&',
		)).toEqual([
			'entry:account=7',
			'entry:account.org=3',
			'entry:account.org.owner=acme',
			'entry:id=913',
		]);
	});

	it('renders the bare collection when the fingerprint pins nothing', () => {
		expect(scopedCacheFingerprintLabels('entry:&fields=,*,&'))
			.toEqual(['entry']);
	});
});

describe('scopedCacheFingerprintMatchesRow', () => {
	const row = renderScopedCacheFingerprint(
		'slot',
		new Map([['owner', ['alpha']], ['method', ['spaced']], ['id', ['913']]]),
	);

	it('matches a row satisfying every pair', () => {
		expect(scopedCacheFingerprintMatchesRow(
			'slot:&fields=,*,&method=,spaced,&owner=,alpha,&',
			row,
		)).toBe(true);
	});

	it('refuses a row satisfying one pair but not the other', () => {
		expect(scopedCacheFingerprintMatchesRow(
			'slot:&fields=,*,&method=,spaced,&owner=,beta,&',
			row,
		)).toBe(false);
	});

	it('matches a row on any value of a multi-valued pair', () => {
		expect(scopedCacheFingerprintMatchesRow(
			'slot:&owner=,alpha,beta,&',
			row,
		)).toBe(true);
	});

	it('matches every row when the fingerprint pins nothing', () => {
		expect(scopedCacheFingerprintMatchesRow('slot:&fields=,*,&', row))
			.toBe(true);
	});

	it(oneLine`
		refuses a row whose value merely starts with the pinned one, which the
		wrapping commas are there to tell apart
	`, () => {
		expect(scopedCacheFingerprintMatchesRow(
			'slot:&owner=,alph,&',
			row,
		)).toBe(false);
	});

	it(oneLine`
		refuses a row matching on another pair's suffix, which the leading
		separator is there to tell apart
	`, () => {
		expect(scopedCacheFingerprintMatchesRow(
			'slot:&ner=,alpha,&',
			row,
		)).toBe(false);
	});

	it('matches a value carrying a separator, escaped on both sides', () => {
		expect(scopedCacheFingerprintMatchesRow(
			renderScopedCacheFingerprint('slot', new Map([['owner', ['a,b']]])),
			renderScopedCacheFingerprint('slot', new Map([['owner', ['a,b']]])),
		)).toBe(true);
	});

	it('refuses a row whose escaped value only looks like two values', () => {
		expect(scopedCacheFingerprintMatchesRow(
			renderScopedCacheFingerprint('slot', new Map([['owner', ['a']]])),
			renderScopedCacheFingerprint('slot', new Map([['owner', ['a,b']]])),
		)).toBe(false);
	});
});

describe('scopedCacheFingerprintFieldsTouched', () => {
	it('is touched by an insert or a delete, whichever fields it names', () => {
		expect(scopedCacheFingerprintFieldsTouched(['id'], null)).toBe(true);
	});

	it('is touched by any column when the read selected every one', () => {
		expect(scopedCacheFingerprintFieldsTouched(['*'], ['note'])).toBe(true);
	});

	it('is touched by a column it names', () => {
		expect(scopedCacheFingerprintFieldsTouched(['id', 'day'], ['day']))
			.toBe(true);
	});

	it('is left alone by a column it never named', () => {
		expect(scopedCacheFingerprintFieldsTouched(['id', 'day'], ['note']))
			.toBe(false);
	});

	it('is touched by a nested change under a wildcard it names', () => {
		expect(scopedCacheFingerprintFieldsTouched(
			['method_range.*'],
			['method_range.method'],
		)).toBe(true);
	});

	it('is left alone by a nested change under the fk column alone', () => {
		expect(scopedCacheFingerprintFieldsTouched(
			['method_range'],
			['method_range.method'],
		)).toBe(false);
	});

	it('is touched when a read naming no field at all meets any write', () => {
		expect(scopedCacheFingerprintFieldsTouched([], ['note'])).toBe(true);
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
		)).toEqual([
			'slot:&fields=,id,owner,&method=,spaced,&owner=,alpha,&',
			'zone:&area=,north,&fields=,area,&',
		]);
	});

	// The `_or` across two fields: a row matching either changes the response, so
	// each way is its own fingerprint. One fingerprint holding both pairs would
	// match a row carrying both and nothing else.
	it('renders one fingerprint per way the read matches a collection', () => {
		expect(scopedCacheFingerprintsByCollection(
			[
				[{ collection: 'slot', field: 'owner', value: 'alpha' }],
				[{ collection: 'slot', field: 'dept', value: 'rh' }],
			],
			new Map([['slot', ['id']]]),
		)).toEqual([
			'slot:&fields=,id,&owner=,alpha,&',
			'slot:&dept=,rh,&fields=,id,&',
		]);
	});

	it('renders a bare tag as a fingerprint pinning nothing but its fields', () => {
		expect(scopedCacheFingerprintsByCollection(
			[[{ collection: 'slot' }]],
			new Map([['slot', ['id', 'note']]]),
		)).toEqual(['slot:&fields=,id,note,&']);
	});

	it(oneLine`
		renders a collection whose fields are unknown as one any write matches
	`, () => {
		expect(scopedCacheFingerprintsByCollection([[{ collection: 'slot' }]]))
			.toEqual(['slot:&']);
	});

	it('carries the same query case once, however many times it is named', () => {
		expect(scopedCacheFingerprintsByCollection([
			[{ collection: 'slot', field: 'owner', value: 'alpha' }],
			[{ collection: 'slot', field: 'owner', value: 'alpha' }],
		])).toEqual(['slot:&owner=,alpha,&']);
	});
});

describe('scopedCacheFingerprintPurgedBy', () => {
	const read = 'slot:&fields=,id,owner,&method=,spaced,&owner=,alpha,&';

	it('purges when the row satisfies every pair and a bound field changed', () => {
		expect(scopedCacheFingerprintPurgedBy(
			read,
			['slot:&id=,1,&method=,spaced,&owner=,alpha,&'],
			['owner'],
		)).toBe(true);
	});

	it(oneLine`
		leaves the read alone when the row satisfies one pair but not the other
	`, () => {
		expect(scopedCacheFingerprintPurgedBy(
			read,
			['slot:&id=,1,&method=,spaced,&owner=,beta,&'],
			['owner'],
		)).toBe(false);
	});

	it('leaves the read alone when the write changed no field it is bound to', () => {
		expect(scopedCacheFingerprintPurgedBy(
			read,
			['slot:&id=,1,&method=,spaced,&owner=,alpha,&'],
			['note'],
		)).toBe(false);
	});

	// A pinned field is bound whether or not the read also selected it: the row
	// crossing it enters or leaves the result set, which is a changed response by
	// itself. This is how a read sliced by a path — `course:&tu.owner.user=,7,&` —
	// survives a write that only rewrote the fk that path runs through.
	it('purges on a pinned field the read never selected', () => {
		expect(scopedCacheFingerprintPurgedBy(
			'course:&fields=,id,name,&tu.owner.user=,7,&',
			['course:&id=,1,&tu.owner.user=,7,&'],
			['tu', 'tu.owner.user'],
		)).toBe(true);
	});

	it('purges on an insert, whichever columns the row carries', () => {
		expect(scopedCacheFingerprintPurgedBy(
			read,
			['slot:&id=,1,&method=,spaced,&owner=,alpha,&'],
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
				'slot:&id=,1,&method=,spaced,&owner=,beta,&',
				'slot:&id=,1,&method=,spaced,&owner=,alpha,&',
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
				'slot:&id=,1,&method=,spaced,&owner=,alpha,&',
				'slot:&id=,1,&method=,spaced,&owner=,sigma,&',
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
				'slot:&id=,1,&method=,massed,&owner=,alpha,&',
				'slot:&id=,2,&method=,spaced,&owner=,beta,&',
			],
			null,
		)).toBe(false);
	});

	it('purges a read pinning nothing on any write to its collection', () => {
		expect(scopedCacheFingerprintPurgedBy(
			'slot:&',
			['slot:&id=,1,&owner=,beta,&'],
			['note'],
		)).toBe(true);
	});

	it('purges a read bounded to a list of owners by a write to either', () => {
		expect(scopedCacheFingerprintPurgedBy(
			'slot:&fields=,id,owner,&owner=,kappa,lambda,&',
			['slot:&id=,1,&owner=,lambda,&'],
			['owner'],
		)).toBe(true);
	});

	it(oneLine`
		leaves a read bounded to a list of owners alone for a write outside it
	`, () => {
		expect(scopedCacheFingerprintPurgedBy(
			'slot:&fields=,id,owner,&owner=,mu,nu,&',
			['slot:&id=,1,&owner=,xi,&'],
			['owner'],
		)).toBe(false);
	});

	it('purges a read of every field on a change to any column', () => {
		expect(scopedCacheFingerprintPurgedBy(
			'slot:&fields=,*,&owner=,zeta,&',
			['slot:&id=,1,&owner=,zeta,&'],
			['note'],
		)).toBe(true);
	});
});
