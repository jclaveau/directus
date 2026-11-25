import { useEnv } from '@directus/env';
import { oneLine } from '@directus/utils';
import { expect, test, vi } from 'vitest';
import { getAuthProvider, registerAuthProviders } from './auth.js';

vi.mock('@directus/env');
vi.mock('./database/index.js', () => ({ default: vi.fn() }));
vi.mock('./utils/get-schema.js', () => ({ getSchema: vi.fn() }));

vi.mock('./logger/index.js', () => {
	return { useLogger: () => ({ error: vi.fn(), warn: vi.fn() }) };
});

vi.mock('./utils/get-config-from-env.js', () => {
	return { getConfigFromEnv: vi.fn(() => ({ driver: 'oauth2' })) };
});

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

test(oneLine`
	registers the default provider alone when AUTH_PROVIDERS is empty
`, async () => {
	vi.mocked(useEnv, { partial: true }).mockReturnValue({ AUTH_PROVIDERS: [] });

	await registerAuthProviders();

	expect(getAuthProvider('default')).toEqual({ driver: 'local' });
	expect(() => getAuthProvider('github')).toThrow(/^Invalid config\.$/);
});

test('registers each provider AUTH_PROVIDERS lists', async () => {
	vi.mocked(useEnv, { partial: true })
		.mockReturnValue({ AUTH_PROVIDERS: ['github'] });

	await registerAuthProviders();

	expect(getAuthProvider('github')).toEqual({ driver: 'oauth2' });
});
