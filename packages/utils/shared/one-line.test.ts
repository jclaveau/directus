import { describe, expect, it } from 'vitest';
import { oneLine } from './one-line.js';

describe('oneLine', () => {
	it('collapses a wrapped multi-line template to a single trimmed line', () => {
		const result = oneLine`
			null scopedCacheTags falls back to a full flush (unresolvable mutation)
		`;

		expect(result).toBe(
			'null scopedCacheTags falls back to a full flush (unresolvable mutation)',
		);
	});

	it('collapses interior newlines but preserves intra-line spacing', () => {
		expect(oneLine`
			one   two
			three
		`).toBe('one   two three');
	});

	it('collapses CRLF newlines without leaving a stray carriage return', () => {
		expect(oneLine`foo bar\r\nbaz qux`).toBe('foo bar baz qux');
	});

	it('interpolates values into the collapsed line', () => {
		const kind = 'o2m';
		expect(oneLine`tags the ${kind} relation`).toBe('tags the o2m relation');
	});

	it('returns a single-line input unchanged bar trimming', () => {
		expect(oneLine`  already one line  `).toBe('already one line');
	});
});
