import { test, expect, vi } from 'vitest';
import { createI18n } from 'vue-i18n';

import { userName } from '@/utils/user-name';

vi.mock('@/lang', () => {
	return {
		i18n: createI18n({
			legacy: false,
			locale: 'en-US',
			messages: {
				'en-US': {
					unknown_user: 'TEST_UNKNOWN',
				},
			},
		}),
	};
});

test(`Returns unknown when user isn't passed`, () => {
	expect(userName()).toBe('TEST_UNKNOWN');
	expect(userName(undefined)).toBe('TEST_UNKNOWN');
});

test(`Returns first + last name if both exist`, () => {
	expect(userName({ first_name: 'Test', last_name: 'Last' })).toBe('Test Last');
});

test(`Returns just first name if last name doesn't exist`, () => {
	expect(userName({ first_name: 'Test' })).toBe('Test');
});

test(`Returns the primary email address if first name doesn't exist`, () => {
	expect(
		userName({
			primary_identity: {
				id: '4f1f6f0e-9a59-4c5e-8d4b-0c2a6f0d1e11',
				user: '12345',
				kind: 'email',
				value: 'test@example.com',
				verified: true,
				auth_data: null,
				user_info: null,
				scope: null,
			},
		}),
	).toBe('test@example.com');
});

test(`Returns unknown when the primary identity is an SSO one`, () => {
	expect(
		userName({
			primary_identity: {
				id: '4f1f6f0e-9a59-4c5e-8d4b-0c2a6f0d1e11',
				user: '12345',
				kind: 'github',
				value: '583231',
				verified: true,
				auth_data: null,
				user_info: null,
				scope: null,
			},
		}),
	).toBe('TEST_UNKNOWN');
});

test(`Returns unknown if name and email are missing`, () => {
	expect(userName({ id: '12345' })).toBe('TEST_UNKNOWN');
});
