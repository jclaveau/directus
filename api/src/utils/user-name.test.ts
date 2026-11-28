import { expect, test } from 'vitest';
import { userName } from './user-name.js';

const unknownUser = 'Unknown User';

test('should return "Unknown User" when user is undefined', () => {
	expect(userName(undefined as any)).toBe(unknownUser);
});

test('should return "Test User" when user first name is "Test" and last name is "User"', () => {
	expect(userName({ first_name: 'Test', last_name: 'User' })).toBe('Test User');
});

test('should return "Test" when user first name is "Test" but does not have last name', () => {
	expect(userName({ first_name: 'Test' })).toBe('Test');
});

test('returns the primary identity value when it is an email', () => {
	expect(userName({
		primary_identity: {
			kind: 'email',
			value: 'test@example.com',
		} as any,
	})).toBe('test@example.com');
});

test('returns "Unknown User" when the primary identity is an SSO identity', () => {
	expect(userName({
		primary_identity: {
			kind: 'github',
			value: '583231',
		} as any,
	})).toBe(unknownUser);
});

test('returns "Unknown User" when the primary identity is a bare key', () => {
	expect(userName({
		primary_identity: '6f0c4c7e-0d6a-4f8e-9a51-2a0f4b8e9c11',
	})).toBe(unknownUser);
});

test('should return "Unknown User" when user is empty', () => {
	expect(userName({})).toBe(unknownUser);
});
