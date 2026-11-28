import { expect, test } from 'vitest';
import { userEmail } from '@/utils/user-email';

test('Returns the value of an email primary identity', () => {
	expect(
		userEmail({
			primary_identity: {
				id: '4f1f6f0e-9a59-4c5e-8d4b-0c2a6f0d1e11',
				user: '12345',
				kind: 'email',
				value: 'ada@example.com',
				verified: false,
				auth_data: null,
				user_info: null,
				scope: null,
			},
		}),
	).toBe('ada@example.com');
});

test('Returns null for an SSO primary identity', () => {
	expect(
		userEmail({
			primary_identity: {
				id: '4f1f6f0e-9a59-4c5e-8d4b-0c2a6f0d1e11',
				user: '12345',
				kind: 'openid',
				value: 'f3c1d9e2',
				verified: true,
				auth_data: null,
				user_info: null,
				scope: 'openid',
			},
		}),
	).toBe(null);
});

test('Returns null for a primary identity read as its key', () => {
	expect(userEmail({ primary_identity: '4f1f6f0e-9a59-4c5e-8d4b-0c2a6f0d1e11' }))
		.toBe(null);
});

test('Returns null for a user without primary identity', () => {
	expect(userEmail({ primary_identity: null })).toBe(null);
	expect(userEmail(null)).toBe(null);
});
