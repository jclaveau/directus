import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
	findAuthProvider,
	getAuthProvider,
	registerAuthProviders,
} from './auth.js';
import { OAuth2AuthDriver, OpenIDAuthDriver } from './auth/drivers/index.js';
import { getConfigFromEnv } from './utils/get-config-from-env.js';

// Hoisted: `constants.ts` reads the env as `auth.ts` imports it.
const mockedDeps = vi.hoisted(() => {
	return {
		logger: { error: vi.fn(), warn: vi.fn() },
		env: { AUTH_PROVIDERS: [] } as Record<string, unknown>,
	};
});

vi.mock('@directus/env', () => ({ useEnv: () => mockedDeps.env }));
vi.mock('./database/index.js', () => ({ default: vi.fn() }));
vi.mock('./utils/get-schema.js', () => ({ getSchema: vi.fn() }));
vi.mock('./utils/get-config-from-env.js', () => ({ getConfigFromEnv: vi.fn() }));
vi.mock('./logger/index.js', () => ({ useLogger: () => mockedDeps.logger }));

vi.mock('./auth/drivers/index.js', () => {
	return {
		LDAPAuthDriver: vi.fn(),
		LocalAuthDriver: vi.fn(function () {
			return { driver: 'local' };
		}),
		OAuth2AuthDriver: vi.fn(function () {
			return { driver: 'oauth2' };
		}),
		OpenIDAuthDriver: vi.fn(),
		SAMLAuthDriver: vi.fn(),
	};
});

beforeEach(() => {
	vi.spyOn(process, 'exit').mockImplementation(() => {
		throw new Error('process.exit');
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

test(oneLine`
	registers the default provider alone when AUTH_PROVIDERS is empty
`, async () => {
	mockedDeps.env = { AUTH_PROVIDERS: [] };

	await registerAuthProviders();

	expect(getAuthProvider('default')).toEqual({ driver: 'local' });
	expect(() => getAuthProvider('github')).toThrow(/^Invalid config\.$/);
});

test('registers each provider AUTH_PROVIDERS lists', async () => {
	mockedDeps.env = { AUTH_PROVIDERS: ['github'] };

	vi.mocked(getConfigFromEnv).mockReturnValue({
		driver: 'oauth2',
		requireVerifiedEmail: false,
	});

	await registerAuthProviders();

	expect(getAuthProvider('github')).toEqual({ driver: 'oauth2' });
});

test('an oauth2 provider without the key fails the boot', async () => {
	mockedDeps.env = { AUTH_PROVIDERS: ['sso'], AUTH_DISABLE_DEFAULT: true };
	vi.mocked(getConfigFromEnv).mockReturnValue({ driver: 'oauth2' });

	await expect(registerAuthProviders()).rejects.toThrow('process.exit');

	expect(mockedDeps.logger.error).toHaveBeenCalledExactlyOnceWith(
		'"AUTH_SSO_REQUIRE_VERIFIED_EMAIL" is true by default, but provider'
		+ ' "sso" (oauth2) can\'t tell a verified email:'
		+ ' set "AUTH_SSO_EMAIL_VERIFIED_KEY",'
		+ ' or set "AUTH_SSO_REQUIRE_VERIFIED_EMAIL" to false',
	);

	expect(OAuth2AuthDriver).not.toHaveBeenCalled();
});

test('an openid provider boots, requiring a verified email', async () => {
	mockedDeps.env = { AUTH_PROVIDERS: ['sso'], AUTH_DISABLE_DEFAULT: true };
	vi.mocked(getConfigFromEnv).mockReturnValue({ driver: 'openid' });

	await registerAuthProviders();

	expect(mockedDeps.logger.error).not.toHaveBeenCalled();

	expect(OpenIDAuthDriver).toHaveBeenCalledExactlyOnceWith(
		{ knex: undefined, schema: undefined },
		{ provider: 'sso' },
	);

	expect(getAuthProvider('sso')).toBeInstanceOf(OpenIDAuthDriver);
});

test('findAuthProvider answers undefined for an unknown provider', async () => {
	mockedDeps.env = { AUTH_PROVIDERS: [] };

	await registerAuthProviders();

	expect(findAuthProvider('default')).toEqual({ driver: 'local' });
	expect(findAuthProvider('gitlab')).toBe(undefined);
});

test('a provider named email fails the boot', async () => {
	mockedDeps.env = { AUTH_PROVIDERS: ['email'] };

	await expect(registerAuthProviders()).rejects.toThrow('process.exit');

	expect(mockedDeps.logger.error).toHaveBeenCalledExactlyOnceWith(
		'Cannot name an auth provider "email": it is the kind of the identities'
		+ ' the default provider logs in with.',
	);
});
