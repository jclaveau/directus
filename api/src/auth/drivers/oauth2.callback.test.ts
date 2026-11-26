import { oneLine } from '@directus/utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { verifyJWT } from '../../utils/jwt.js';
import { createOAuth2AuthRouter } from './oauth2.js';

const { mockEnv } = vi.hoisted(() => {
	return {
		mockEnv: {
			AUTH_PROVIDERS: [],
			PUBLIC_URL: 'http://localhost:8055',
			SESSION_COOKIE_NAME: 'session_cookie',
			REFRESH_TOKEN_COOKIE_NAME: 'refresh_cookie',
		} as Record<string, unknown>,
	};
});

vi.mock('@directus/env', () => ({ useEnv: () => mockEnv }));
vi.mock('../../database/index.js', () => ({ default: vi.fn() }));
vi.mock('../../utils/get-secret.js', () => ({ getSecret: () => 'secret' }));
vi.mock('../../utils/jwt.js', () => ({ verifyJWT: vi.fn() }));

vi.mock('../../logger/index.js', () => {
	return { useLogger: () => ({ warn: vi.fn() }) };
});

vi.mock('../../services/authentication.js', () => {
	return {
		AuthenticationService: vi.fn(() => {
			return {
				login: vi.fn(async () => {
					return {
						accessToken: 'access-token',
						refreshToken: 'refresh-token',
						expires: 1,
					};
				}),
			};
		}),
	};
});

vi.mock('../../services/users.js', () => ({ UsersService: vi.fn() }));

// The real respond imports the services index, which loads app.ts and the
// controllers back into respond: a cycle the callback route never needs.
vi.mock('../../middleware/respond.js', () => ({ respond: vi.fn() }));

vi.mock('../../services/notifications.js', () => {
	return { NotificationsService: vi.fn() };
});

afterEach(() => {
	delete mockEnv['AUTH_SSO_MODE'];
	vi.clearAllMocks();
});

describe('the oauth2 callback with a redirect', () => {
	test.each([
		{ mode: 'session', cookie: 'session_cookie', token: 'access-token' },
		{ mode: 'json', cookie: 'refresh_cookie', token: 'refresh-token' },
		{ mode: undefined, cookie: 'session_cookie', token: 'access-token' },
	])(oneLine`
		sets the $cookie cookie under AUTH_SSO_MODE $mode
	`, async ({ mode, cookie, token }) => {
		mockEnv['AUTH_SSO_MODE'] = mode;

		vi.mocked(verifyJWT).mockReturnValue({
			verifier: 'verifier',
			redirect: 'http://localhost:8055/admin',
			prompt: false,
		});

		const res = { cookie: vi.fn(), clearCookie: vi.fn(), redirect: vi.fn() };

		await (createOAuth2AuthRouter('sso').stack as any[])
			.find((layer) => {
				return layer.route?.path === '/callback' && layer.route.methods.get;
			})
			.route.stack[0].handle(
				{
					cookies: {},
					ip: '127.0.0.1',
					query: { code: 'code' },
					get: () => undefined,
				},
				res,
				vi.fn(),
			);

		expect(res.cookie).toHaveBeenCalledWith(cookie, token, expect.anything());
		expect(res.redirect).toHaveBeenCalledWith('http://localhost:8055/admin');
	});
});
