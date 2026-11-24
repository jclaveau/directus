import { expect, test } from 'vitest';
import { cast, castDeclaredValue } from './cast.js';

test('a string declaration keeps the leading zero a guess drops', () => {
	expect(cast('0123')).toBe('0123');
	expect(cast('123')).toBe(123);
	expect(castDeclaredValue('123', { type: 'string' })).toBe('123');
	expect(castDeclaredValue('0123', { type: 'string' })).toBe('0123');
});

test('a declaration casts a value without its prefix', () => {
	expect(castDeclaredValue('number:42', { type: 'number' })).toBe(42);
});

test('a boolean declaration reads "1" as true', () => {
	expect(castDeclaredValue('1', { type: 'boolean' })).toBe(true);
});
