import { oneLine } from '@directus/utils';
import { expect, test, vi } from 'vitest';
import { getAuthProvider, registerAuthProviders } from './auth.js';

// Hoisted: `constants.ts` reads the env as `auth.ts` imports it.
const env = vi.hoisted<Record<string, unknown>>(() => {
	return { AUTH_PROVIDERS: [] };
});

vi.mock('@directus/env', () => ({ useEnv: () => env }));
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
	await registerAuthProviders();

	expect(getAuthProvider('default')).toEqual({ driver: 'local' });
	expect(() => getAuthProvider('github')).toThrow(/^Invalid config\.$/);
});

test('registers each provider AUTH_PROVIDERS lists', async () => {
	env['AUTH_PROVIDERS'] = ['github'];

	await registerAuthProviders();

	expect(getAuthProvider('github')).toEqual({ driver: 'oauth2' });
});
