import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getAuthProvider, registerAuthProviders } from './auth.js';
import { OAuth2AuthDriver, OpenIDAuthDriver } from './auth/drivers/index.js';
import { getConfigFromEnv } from './utils/get-config-from-env.js';

const mockedDeps = vi.hoisted(() => {
	return {
		logger: { error: vi.fn(), warn: vi.fn() },
		env: { AUTH_PROVIDERS: 'sso', AUTH_DISABLE_DEFAULT: true },
	};
});

vi.mock('@directus/env', () => ({ useEnv: () => mockedDeps.env }));
vi.mock('./utils/get-config-from-env.js');
vi.mock('./utils/get-schema.js', () => ({ getSchema: vi.fn() }));
vi.mock('./database/index.js', () => ({ default: vi.fn() }));
vi.mock('./logger/index.js', () => ({ useLogger: () => mockedDeps.logger }));

vi.mock('./auth/drivers/index.js', () => {
	return {
		LDAPAuthDriver: vi.fn(),
		LocalAuthDriver: vi.fn(),
		OAuth2AuthDriver: vi.fn(),
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
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	vi.resetAllMocks();
});

test('an oauth2 provider without the key fails the boot', async () => {
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
	vi.mocked(getConfigFromEnv).mockReturnValue({ driver: 'openid' });

	await registerAuthProviders();

	expect(mockedDeps.logger.error).not.toHaveBeenCalled();

	expect(OpenIDAuthDriver).toHaveBeenCalledExactlyOnceWith(
		{ knex: undefined, schema: undefined },
		{ provider: 'sso' },
	);

	expect(getAuthProvider('sso')).toBeInstanceOf(OpenIDAuthDriver);
});
