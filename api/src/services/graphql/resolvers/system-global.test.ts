import { SchemaComposer } from 'graphql-compose';
import { expect, test, vi } from 'vitest';

// graphql-compose requires graphql's CommonJS build while vite hands the source
// the ESM one, so its instanceof checks refuse every type system-global.ts builds.
vi.mock('graphql', async () => {
	const { createRequire } = await import('node:module');

	return createRequire(import.meta.url)('graphql');
});

const logout = vi.fn();

vi.mock('../../authentication.js', () => {
	return {
		AuthenticationService: vi.fn(function () {
			return { logout };
		}),
	};
});

vi.mock('../../../utils/is-directus-jwt.js', () => {
	return {
		default: vi.fn(() => true),
	};
});

vi.mock('../../../utils/jwt.js', () => {
	return {
		verifyAccessJWT: vi.fn(() => ({ session: 'session-id' })),
	};
});

vi.mock('../../../utils/get-secret.js', () => {
	return {
		getSecret: vi.fn(() => 'secret'),
	};
});

const { globalResolvers } = await import('./system-global.js');

const {
	REFRESH_COOKIE_OPTIONS,
	SESSION_COOKIE_OPTIONS,
} = await import('../../../constants.js');

test('auth_logout in cookie mode clears both cookies it was sent', async () => {
	const schemaComposer = new SchemaComposer();
	const clearCookie = vi.fn();

	globalResolvers({ schema: {} } as any, schemaComposer as any);

	const resolved = await schemaComposer.Mutation.getFieldConfig(
		'auth_logout',
	).resolve!(
		undefined,
		{ mode: 'cookie' },
		{
			req: {
				cookies: {
					directus_refresh_token: 'refresh-token',
					directus_session_token: 'session-token',
				},
				get: vi.fn(),
			},
			res: { clearCookie },
		},
		{} as any,
	);

	expect(resolved).toBe(true);
	expect(logout).toHaveBeenCalledWith('refresh-token');

	expect(clearCookie.mock.calls).toEqual([
		['directus_refresh_token', REFRESH_COOKIE_OPTIONS],
		['directus_session_token', SESSION_COOKIE_OPTIONS],
	]);
});

test('auth_logout in session mode ends the session of its cookie', async () => {
	const schemaComposer = new SchemaComposer();
	const clearCookie = vi.fn();

	globalResolvers({ schema: {} } as any, schemaComposer as any);

	const resolved = await schemaComposer.Mutation.getFieldConfig(
		'auth_logout',
	).resolve!(
		undefined,
		{ mode: 'session' },
		{
			req: {
				cookies: { directus_session_token: 'session-token' },
				get: vi.fn(),
			},
			res: { clearCookie },
		},
		{} as any,
	);

	expect(resolved).toBe(true);
	expect(logout).toHaveBeenCalledWith('session-id');

	expect(clearCookie.mock.calls).toEqual([
		['directus_session_token', SESSION_COOKIE_OPTIONS],
	]);
});
