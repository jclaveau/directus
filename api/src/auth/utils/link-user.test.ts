import { ForbiddenError } from '@directus/errors';
import type { Request } from 'express';
import { expect, test } from 'vitest';
import { getLinkUser } from './link-user.js';

test('returns null when no link is asked', () => {
	expect(getLinkUser({
		accountability: { user: '0d2f8a3e-6d1c-4a5b-9e7f-1c2b3a4d5e6f' },
		token: 'session-token',
		cookies: { directus_session_token: 'session-token' },
	} as unknown as Request, undefined)).toBe(null);
});

test('returns null when link is "false"', () => {
	expect(getLinkUser({
		accountability: { user: '0d2f8a3e-6d1c-4a5b-9e7f-1c2b3a4d5e6f' },
		token: 'session-token',
		cookies: { directus_session_token: 'session-token' },
	} as unknown as Request, 'false')).toBe(null);
});

test('returns the session user when link is "true"', () => {
	expect(getLinkUser({
		accountability: { user: '0d2f8a3e-6d1c-4a5b-9e7f-1c2b3a4d5e6f' },
		token: 'session-token',
		cookies: { directus_session_token: 'session-token' },
	} as unknown as Request, 'true')).toBe('0d2f8a3e-6d1c-4a5b-9e7f-1c2b3a4d5e6f');
});

test('returns the session user when link is true', () => {
	expect(getLinkUser({
		accountability: { user: '0d2f8a3e-6d1c-4a5b-9e7f-1c2b3a4d5e6f' },
		token: 'session-token',
		cookies: { directus_session_token: 'session-token' },
	} as unknown as Request, true)).toBe('0d2f8a3e-6d1c-4a5b-9e7f-1c2b3a4d5e6f');
});

test('refuses a link asked without a logged-in session', () => {
	expect(() => {
		return getLinkUser({
			accountability: { user: null },
		} as unknown as Request, 'true');
	}).toThrow(new ForbiddenError({
		reason: 'Linking an identity requires a logged-in session',
	}));
});

test('refuses a link made with a query token, not the session cookie', () => {
	expect(() => {
		return getLinkUser({
			accountability: { user: '0d2f8a3e-6d1c-4a5b-9e7f-1c2b3a4d5e6f' },
			token: 'query-token',
			query: { access_token: 'query-token' },
			cookies: { directus_session_token: 'session-token' },
		} as unknown as Request, 'true');
	}).toThrow(new ForbiddenError({
		reason: 'Linking an identity requires a logged-in session',
	}));
});
