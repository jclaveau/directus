import { describe, expect, it } from 'vitest';
import { parseJsonFieldList } from './parse-json-field-list.js';

describe('parseJsonFieldList', () => {
	it('passes through an already-parsed array (Postgres)', () => {
		expect(parseJsonFieldList(['student', 'owner'])).toEqual(['student', 'owner']);
	});

	it('drops non-string entries', () => {
		expect(parseJsonFieldList(['student', 7, null, { a: 1 }])).toEqual(['student']);
	});

	it('parses a JSON string column (MySQL/SQLite)', () => {
		expect(parseJsonFieldList('["student","owner"]')).toEqual(['student', 'owner']);
	});

	it('returns [] on a malformed JSON string', () => {
		expect(parseJsonFieldList('not json')).toEqual([]);
	});

	it('returns [] when the JSON string parses to a non-array', () => {
		expect(parseJsonFieldList('"student"')).toEqual([]);
		expect(parseJsonFieldList('{"a":1}')).toEqual([]);
	});

	it('returns [] for null / undefined / empty-string / non-array primitives', () => {
		expect(parseJsonFieldList(null)).toEqual([]);
		expect(parseJsonFieldList(undefined)).toEqual([]);
		expect(parseJsonFieldList('')).toEqual([]);
		expect(parseJsonFieldList(42)).toEqual([]);
		expect(parseJsonFieldList({ scoped: true })).toEqual([]);
	});
});
