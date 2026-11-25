import { getConfigFromEnv } from '../../utils/get-config-from-env.js';

/**
 * Whether a login through `provider` replaces the memberships it manages, as
 * its driver decides: oauth2 and openid by ROLE_MAPPING, ldap by GROUP_DN. A
 * provider no longer configured maps none.
 */
export function providerMapsRoles(provider: string): boolean {
	const { driver, roleMapping, groupDn } = getConfigFromEnv(
		`AUTH_${provider.toUpperCase()}_`,
	);

	if (driver === 'ldap') {
		return Boolean(groupDn);
	}

	if (driver === 'oauth2' || driver === 'openid') {
		return Boolean(roleMapping);
	}

	return false;
}
