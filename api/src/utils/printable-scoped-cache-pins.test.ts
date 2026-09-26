import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { describe, expect, test } from 'vitest';
import {
	printableScopedCachePin,
	storedScopedCachePin,
} from './printable-scoped-cache-pins.js';

const nulByte = String.fromCharCode(0);

describe('printableScopedCachePin', () => {
	test('leaves printable ASCII pins untouched', () => {
		expect(printableScopedCachePin('discipline:name=Biology'))
			.toBe('discipline:name=Biology');
	});

	test('percent-encodes the NUL that opens the null token', () => {
		expect(printableScopedCachePin(`discipline:name=${nulByte}null`))
			.toBe('discipline:name=%00null');
	});

	test('percent-encodes non-ASCII values as uppercase UTF-8 bytes', () => {
		expect(printableScopedCachePin('a:b=é')).toBe('a:b=%C3%A9');
		expect(printableScopedCachePin('a:b=Ā')).toBe('a:b=%C4%80');
		expect(printableScopedCachePin('a:b=中')).toBe('a:b=%E4%B8%AD');
		expect(printableScopedCachePin('a:b=😀')).toBe('a:b=%F0%9F%98%80');
	});

	// encodeURIComponent throws URIError on it; U+FFFD is what toWellFormed gives.
	test('encodes a lone surrogate as U+FFFD instead of throwing', () => {
		expect(printableScopedCachePin('a:b=\ud800')).toBe('a:b=%EF%BF%BD');
		expect(printableScopedCachePin('a:b=x\udc00')).toBe('a:b=x%EF%BF%BD');
	});

	test('output never makes res.setHeader throw', () => {
		const printed = printableScopedCachePin(`x:y=中${nulByte}😀é`);

		expect(printed).toMatch(/^[\x20-\x7E]*$/);

		const res = new ServerResponse(new IncomingMessage(new Socket()));

		expect(() => res.setHeader('X-Scoped-Cache-Tags', printed))
			.not.toThrow();
	});
});

describe('storedScopedCachePin', () => {
	test('cuts the printable pin to the 255 a telemetry column holds', () => {
		expect(storedScopedCachePin(`a:b=${'x'.repeat(300)}`))
			.toBe(`a:b=${'x'.repeat(251)}`);
	});

	test('cuts after encoding, where each non-ASCII byte takes three chars', () => {
		expect(storedScopedCachePin(`a:b=${'é'.repeat(50)}`))
			.toBe(`a:b=${'%C3%A9'.repeat(41)}%C3%A`);
	});

	test('leaves a pin within the column untouched', () => {
		expect(storedScopedCachePin('a:b=é')).toBe('a:b=%C3%A9');
	});
});
