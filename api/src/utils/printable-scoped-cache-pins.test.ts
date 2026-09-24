import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { describe, expect, test } from 'vitest';
import { printableScopedCacheTags } from './printable-scoped-cache-tags.js';

const nulByte = String.fromCharCode(0);

describe('printableScopedCacheTags', () => {
	test('leaves printable ASCII tags untouched', () => {
		expect(printableScopedCacheTags('discipline:name=Biology'))
			.toBe('discipline:name=Biology');
	});

	test('percent-encodes the NUL that opens the null token', () => {
		expect(printableScopedCacheTags(`discipline:name=${nulByte}null`))
			.toBe('discipline:name=%00null');
	});

	test('percent-encodes non-ASCII values as uppercase UTF-8 bytes', () => {
		expect(printableScopedCacheTags('a:b=é')).toBe('a:b=%C3%A9');
		expect(printableScopedCacheTags('a:b=Ā')).toBe('a:b=%C4%80');
		expect(printableScopedCacheTags('a:b=中')).toBe('a:b=%E4%B8%AD');
		expect(printableScopedCacheTags('a:b=😀')).toBe('a:b=%F0%9F%98%80');
	});

	test('output never makes res.setHeader throw', () => {
		const printed = printableScopedCacheTags(`x:y=中${nulByte}😀é`);

		expect(printed).toMatch(/^[\x20-\x7E]*$/);

		const res = new ServerResponse(new IncomingMessage(new Socket()));

		expect(() => res.setHeader('X-Scoped-Cache-Tags', printed))
			.not.toThrow();
	});
});
