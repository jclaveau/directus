import { Router } from 'express';
import { expect, test, vi } from 'vitest';

const logout = vi.fn();

vi.mock('../auth/drivers/index.js', () => {
	return {
		createLDAPAuthRouter: vi.fn(),
		createLocalAuthRouter: vi.fn(() => Router()),
		createOAuth2AuthRouter: vi.fn(),
		createOpenIDAuthRouter: vi.fn(),
		createSAMLAuthRouter: vi.fn(),
	};
});

vi.mock('../utils/get-auth-providers.js', () => {
	return {
		getAuthProviders: vi.fn(() => []),
	};
});

vi.mock('../services/authentication.js', () => {
	return {
		AuthenticationService: vi.fn(function () {
			return { logout };
		}),
	};
});

vi.mock('../middleware/respond.js', () => ({ respond: vi.fn() }));

const { default: router } = await import('./auth.js');

const {
	REFRESH_COOKIE_OPTIONS,
	SESSION_COOKIE_OPTIONS,
} = await import('../constants.js');

test('logout clears the refresh and session cookies it was sent', async () => {
	const clearCookie = vi.fn();
	const next = vi.fn();

	await router.stack.find(
		(l: any) => l.route?.path === '/logout' && l.route.methods['post'],
	)!.route!.stack[0]!.handle(
		{
			body: { refresh_token: 'refresh-token' },
			cookies: {
				directus_refresh_token: 'refresh-token',
				directus_session_token: 'session-token',
			},
			get: vi.fn(),
			ip: '127.0.0.1',
			schema: {},
		} as any,
		{ clearCookie } as any,
		next,
	);

	expect(next).toHaveBeenCalledWith();
	expect(logout).toHaveBeenCalledWith('refresh-token');

	expect(clearCookie.mock.calls).toEqual([
		['directus_refresh_token', REFRESH_COOKIE_OPTIONS],
		['directus_session_token', SESSION_COOKIE_OPTIONS],
	]);
});
