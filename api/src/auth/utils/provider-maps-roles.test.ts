import { afterEach, expect, test, vi } from 'vitest';
import { getConfigFromEnv } from '../../utils/get-config-from-env.js';
import { providerMapsRoles } from './provider-maps-roles.js';

vi.mock('../../utils/get-config-from-env.js');

afterEach(() => {
	vi.restoreAllMocks();
});

test.each([
	[{ driver: 'openid', roleMapping: { staff: 'role-a' } }, true],
	[{ driver: 'oauth2', roleMapping: { staff: 'role-a' } }, true],
	[{ driver: 'oauth2' }, false],
	[{ driver: 'ldap', groupDn: 'ou=groups' }, true],
	[{ driver: 'ldap' }, false],
	[{ driver: 'saml' }, false],
	[{}, false],
])('the provider configured %j maps roles: %s', (providerConfig, mapsRoles) => {
	vi.mocked(getConfigFromEnv).mockReturnValue(providerConfig);

	expect(providerMapsRoles('sso')).toBe(mapsRoles);
	expect(getConfigFromEnv).toHaveBeenCalledExactlyOnceWith('AUTH_SSO_');
});
