import { oneLine } from '@directus/utils';
import { describe, expect, it } from 'vitest';
import {
	parseScopedCacheFingerprint,
	renderScopedCacheFingerprint,
	scopedCacheFingerprintFieldsTouched,
	scopedCacheFingerprintFromTags,
	scopedCacheFingerprintsByCollection,
	scopedCacheFingerprintLabels,
	scopedCacheFingerprintMatchesRow,
	scopedCacheFingerprintPurgedBy,
	scopedCacheRowIndexGlobs,
} from './fingerprint.js';

describe('renderScopedCacheFingerprint', () => {
	it('sorts the pairs and wraps every value in commas', () => {
		expect(renderScopedCacheFingerprint({
			collection: 'student_time_slot',
			pairs: new Map([['user', ['A']], ['course_part', ['4821']]]),
			fields: ['course_part', 'day', 'id'],
		})).toBe(
			'student_time_slot:&course_part=,4821,&fields=,course_part,day,id,'
			+ '&user=,A,&',
		);
	});

	// The `*` of a read bound to every field is escaped like any other token: a
	// field cannot be named `*`, so nothing is lost, and the escape rule stays one
	// rule rather than one rule and an exception a pattern would have to know.
	it('lists a multi-valued pair once, sorted and deduped', () => {
		expect(renderScopedCacheFingerprint({
			collection: 'student_time_slot',
			pairs: new Map([['course_part', ['2', '1', '2']]]),
			fields: ['*'],
		})).toBe('student_time_slot:&course_part=,1,2,&fields=,\\*,&');
	});

	it('leaves out the fields pair when the read names none', () => {
		expect(renderScopedCacheFingerprint({
			collection: 'student_time_slot',
			pairs: new Map([['user', ['A']]]),
			fields: [],
		})).toBe('student_time_slot:&user=,A,&');
	});

	it('renders a collection bound to nothing', () => {
		expect(renderScopedCacheFingerprint(
			{ collection: 'student_time_slot', pairs: new Map(), fields: [] },
		)).toBe('student_time_slot:&');
	});

	it('escapes a value carrying a separator', () => {
		expect(renderScopedCacheFingerprint({
			collection: 'note',
			pairs: new Map([['title', ['a,b&c|d\\e']]]),
			fields: [],
		})).toBe('note:&title=,a\\,b\\&c\\|d\\\\e,&');
	});

	// A raw one would make the pattern a purge builds around this value match
	// slices the value never named, which is a purge of somebody else's entries.
	it('escapes a value carrying a glob metacharacter', () => {
		expect(renderScopedCacheFingerprint({
			collection: 'note',
			pairs: new Map([['title', ['a*b?c[d]']]]),
			fields: [],
		})).toBe('note:&title=,a\\*b\\?c\\[d\\],&');
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

	it('unescapes a value carrying a glob metacharacter', () => {
		expect([...parseScopedCacheFingerprint(
			'note:&title=,a\\*b\\?c\\[d\\],&',
		).pairs]).toEqual([['title', ['a*b?c[d]']]]);
	});

	it('reads back a collection bound to nothing', () => {
		const parsed = parseScopedCacheFingerprint('student_time_slot:&');

		expect(parsed.collection).toBe('student_time_slot');
		expect([...parsed.pairs]).toEqual([]);
		expect(parsed.fields).toEqual([]);
	});

	it('reads back a value whose escapes only look like two values', () => {
		expect([...parseScopedCacheFingerprint(
			renderScopedCacheFingerprint(
				{ collection: 'slot', pairs: new Map([['owner', ['a,b']]]), fields: [] },
			),
		).pairs]).toEqual([['owner', ['a,b']]]);
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
		)).toEqual({
			collection: 'note',
			pairs: new Map([['owner', ['a', 'b']], ['id', ['7']]]),
			fields: ['*'],
		});
	});

	it('canonicalizes each value the way the tag key does', () => {
		expect(scopedCacheFingerprintFromTags(
			'note',
			[
				{ collection: 'note', field: 'id', value: '007', type: 'integer' },
				{ collection: 'note', field: 'flag', value: 't', type: 'boolean' },
			],
		)).toEqual({
			collection: 'note',
			pairs: new Map([['id', ['7']], ['flag', ['true']]]),
			fields: [],
		});
	});

	it('drops a bare tag, which pins nothing', () => {
		expect(scopedCacheFingerprintFromTags('note', [{ collection: 'note' }]))
			.toEqual({ collection: 'note', pairs: new Map(), fields: [] });
	});
});

describe('scopedCacheFingerprintLabels', () => {
	it('renders one legacy label per value, without the fields pair', () => {
		expect(scopedCacheFingerprintLabels(parseScopedCacheFingerprint(
			'entry:&account=,7,&account.org=,3,&account.org.owner=,acme,'
			+ '&fields=,*,&id=,913,&',
		))).toEqual([
			'entry:account=7',
			'entry:account.org=3',
			'entry:account.org.owner=acme',
			'entry:id=913',
		]);
	});

	it('renders the bare collection when the fingerprint pins nothing', () => {
		expect(scopedCacheFingerprintLabels(
			parseScopedCacheFingerprint('entry:&fields=,*,&'),
		)).toEqual(['entry']);
	});
});

describe('scopedCacheFingerprintMatchesRow', () => {
	const row = parseScopedCacheFingerprint(
		'slot:&id=,913,&method=,spaced,&owner=,alpha,&',
	);

	it('matches a row satisfying every pair', () => {
		expect(scopedCacheFingerprintMatchesRow(
			parseScopedCacheFingerprint('slot:&fields=,*,&method=,spaced,&owner=,alpha,&'),
			row,
		)).toBe(true);
	});

	it('refuses a row satisfying one pair but not the other', () => {
		expect(scopedCacheFingerprintMatchesRow(
			parseScopedCacheFingerprint('slot:&fields=,*,&method=,spaced,&owner=,beta,&'),
			row,
		)).toBe(false);
	});

	it('matches a row on any value of a multi-valued pair', () => {
		expect(scopedCacheFingerprintMatchesRow(
			parseScopedCacheFingerprint('slot:&owner=,alpha,beta,&'),
			row,
		)).toBe(true);
	});

	it('matches every row when the fingerprint pins nothing', () => {
		expect(scopedCacheFingerprintMatchesRow(
			parseScopedCacheFingerprint('slot:&fields=,*,&'),
			row,
		)).toBe(true);
	});

	it('refuses a row whose value merely starts with the pinned one', () => {
		expect(scopedCacheFingerprintMatchesRow(
			parseScopedCacheFingerprint('slot:&owner=,alph,&'),
			row,
		)).toBe(false);
	});

	it('refuses a row carrying no pair of that name at all', () => {
		expect(scopedCacheFingerprintMatchesRow(
			parseScopedCacheFingerprint('slot:&ner=,alpha,&'),
			row,
		)).toBe(false);
	});

	it('matches a value carrying a separator', () => {
		expect(scopedCacheFingerprintMatchesRow(
			{ collection: 'slot', pairs: new Map([['owner', ['a,b']]]), fields: [] },
			{ collection: 'slot', pairs: new Map([['owner', ['a,b']]]), fields: [] },
		)).toBe(true);
	});

	it('refuses a row whose value only looks like the pinned one', () => {
		expect(scopedCacheFingerprintMatchesRow(
			{ collection: 'slot', pairs: new Map([['owner', ['a']]]), fields: [] },
			{ collection: 'slot', pairs: new Map([['owner', ['a,b']]]), fields: [] },
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
		).map(renderScopedCacheFingerprint)).toEqual([
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
		).map(renderScopedCacheFingerprint)).toEqual([
			'slot:&fields=,id,&owner=,alpha,&',
			'slot:&dept=,rh,&fields=,id,&',
		]);
	});

	it('renders a bare tag as a fingerprint pinning nothing but its fields', () => {
		expect(scopedCacheFingerprintsByCollection(
			[[{ collection: 'slot' }]],
			new Map([['slot', ['id', 'note']]]),
		).map(renderScopedCacheFingerprint)).toEqual(['slot:&fields=,id,note,&']);
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
		'slot:&fields=,id,owner,&method=,spaced,&owner=,alpha,&',
	);

	it('purges when the row satisfies every pair and a bound field changed', () => {
		expect(scopedCacheFingerprintPurgedBy(
			read,
			[parseScopedCacheFingerprint('slot:&id=,1,&method=,spaced,&owner=,alpha,&')],
			['owner'],
		)).toBe(true);
	});

	it(oneLine`
		leaves the read alone when the row satisfies one pair but not the other
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
			parseScopedCacheFingerprint('course:&fields=,id,name,&tu.owner.user=,7,&'),
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
			parseScopedCacheFingerprint('slot:&fields=,id,owner,&owner=,kappa,lambda,&'),
			[parseScopedCacheFingerprint('slot:&id=,1,&owner=,lambda,&')],
			['owner'],
		)).toBe(true);
	});

	it(oneLine`
		leaves a read bounded to a list of owners alone for a write outside it
	`, () => {
		expect(scopedCacheFingerprintPurgedBy(
			parseScopedCacheFingerprint('slot:&fields=,id,owner,&owner=,mu,nu,&'),
			[parseScopedCacheFingerprint('slot:&id=,1,&owner=,xi,&')],
			['owner'],
		)).toBe(false);
	});

	it('purges a read of every field on a change to any column', () => {
		expect(scopedCacheFingerprintPurgedBy(
			parseScopedCacheFingerprint('slot:&fields=,*,&owner=,zeta,&'),
			[parseScopedCacheFingerprint('slot:&id=,1,&owner=,zeta,&')],
			['note'],
		)).toBe(true);
	});
});

describe('scopedCacheRowIndexGlobs', () => {
	it('names one pattern per pair the row pins, and the two that pin none', () => {
		expect(scopedCacheRowIndexGlobs('slot', [
			parseScopedCacheFingerprint('slot:&id=,1,&owner=,alpha,&'),
		])).toEqual([
			'slot:&|*',
			'slot:&fields=,*',
			'slot:*&id=*,1,*',
			'slot:*&owner=*,alpha,*',
		]);
	});

	it('names each value of a multi-valued pair, once across the batch', () => {
		expect(scopedCacheRowIndexGlobs('slot', [
			parseScopedCacheFingerprint('slot:&owner=,alpha,&'),
			parseScopedCacheFingerprint('slot:&owner=,beta,&'),
			parseScopedCacheFingerprint('slot:&owner=,alpha,&'),
		])).toEqual([
			'slot:&|*',
			'slot:&fields=,*',
			'slot:*&owner=*,alpha,*',
			'slot:*&owner=*,beta,*',
		]);
	});

	// The value is stored escaped (`a\*b`), and a glob eats a backslash rather than
	// matching one, so the pattern doubles what the serialiser wrote.
	it('escapes a value carrying a glob metacharacter', () => {
		expect(scopedCacheRowIndexGlobs('slot', [
			{ collection: 'slot', pairs: new Map([['owner', ['a*b']]]), fields: [] },
		])).toEqual([
			'slot:&|*',
			'slot:&fields=,*',
			'slot:*&owner=*,a\\\\\\*b,*',
		]);
	});

	it('escapes a value carrying a separator', () => {
		expect(scopedCacheRowIndexGlobs('slot', [
			{ collection: 'slot', pairs: new Map([['owner', ['a,b']]]), fields: [] },
		])).toEqual([
			'slot:&|*',
			'slot:&fields=,*',
			'slot:*&owner=*,a\\\\,b,*',
		]);
	});

	it(oneLine`
		gives up on filtering past the bound, so a wide batch reads its sets whole
		instead of walking them once per slice
	`, () => {
		const rowFingerprints = Array.from({ length: 65 }, (_value, at) => {
			return { collection: 'slot', pairs: new Map([['id', [`${at}`]]]), fields: [] };
		});

		expect(scopedCacheRowIndexGlobs('slot', rowFingerprints)).toBe(null);
	});
});
