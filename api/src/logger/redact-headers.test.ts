import { REDACTED_TEXT } from '@directus/utils';
import { describe, expect, test } from 'vitest';
import { redactHeaders } from './redact-headers.js';

// Pins the HTTP-logger redaction contract so the pino v10 bump (which retyped the
// censor `value` from `any` to `unknown`) keeps redacting exactly the same way.
describe('redactHeaders', () => {
	test('redacts only set-cookie within res.headers, keeping other headers', () => {
		const headers = { 'set-cookie': 'session=secret', 'content-type': 'application/json' };

		const result = redactHeaders(headers, ['res', 'headers']);

		expect(result).toEqual({ 'set-cookie': REDACTED_TEXT, 'content-type': 'application/json' });
	});

	test('returns res.headers unchanged when there is no set-cookie', () => {
		const headers = { 'content-type': 'application/json' };

		expect(redactHeaders(headers, ['res', 'headers'])).toEqual({ 'content-type': 'application/json' });
	});

	test('does not throw when res.headers value is not an object (pino 10 unknown typing)', () => {
		expect(redactHeaders('not-an-object', ['res', 'headers'])).toBe('not-an-object');
		expect(redactHeaders(undefined, ['res', 'headers'])).toBeUndefined();
	});

	test.each([
		['req', 'headers', 'authorization'],
		['req', 'headers', 'cookie'],
		['req', 'query', 'access_token'],
	])('fully redacts the scalar path %j', (...pathParts) => {
		expect(redactHeaders('sensitive-value', pathParts)).toBe(REDACTED_TEXT);
	});
});
