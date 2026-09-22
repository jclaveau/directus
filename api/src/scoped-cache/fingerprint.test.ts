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
		folds a collection's pins into one fingerprint, and each collection into its
		own
	`, () => {
		expect(scopedCacheFingerprintsByCollection(
			[
				{ collection: 'slot', field: 'owner', value: 'alpha' },
				{ collection: 'zone', field: 'area', value: 'north' },
				{ collection: 'slot', field: 'method', value: 'spaced' },
			],
			new Map([['slot', ['id', 'owner']], ['zone', ['area']]]),
		)).toEqual([
			'slot:&fields=,id,owner,&method=,spaced,&owner=,alpha,&',
			'zone:&area=,north,&fields=,area,&',
		]);
	});

	it('renders a bare tag as a fingerprint pinning nothing but its fields', () => {
		expect(scopedCacheFingerprintsByCollection(
			[{ collection: 'slot' }],
			new Map([['slot', ['id', 'note']]]),
		)).toEqual(['slot:&fields=,id,note,&']);
	});

	it(oneLine`
		renders a collection whose fields are unknown as one any write matches
	`, () => {
		expect(scopedCacheFingerprintsByCollection([{ collection: 'slot' }]))
			.toEqual(['slot:&']);
	});
});
