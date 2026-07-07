import type { Accountability } from '@directus/types';
import type { Knex } from 'knex';
import { withCache } from '../../utils/with-cache.js';
import { fetchGlobalAccessForRoles } from './lib/fetch-global-access-for-roles.js';
import { fetchGlobalAccessForUser } from './lib/fetch-global-access-for-user.js';
import type { GlobalAccess } from './types.js';

export const fetchGlobalAccess = withCache('global-access', _fetchGlobalAccess, ({ user, roles, ip }) => ({
	user,
	roles,
	ip,
}));

/**
 * Fetch the global access (eg admin/app access) rules for the given roles, or roles+user combination
 *
 * Will fetch roles and user info separately so they can be cached and reused individually
 */
export async function _fetchGlobalAccess(
	accountability: Pick<Accountability, 'user' | 'roles' | 'ip'>,
	knex: Knex,
): Promise<GlobalAccess> {
	const access = await fetchGlobalAccessForRoles(accountability, knex);

	if (accountability.user !== undefined) {
		const userAccess = await fetchGlobalAccessForUser(accountability, knex);

		// If app/admin is already true, keep it true
		access.app ||= userAccess.app;
		access.admin ||= userAccess.admin;

		// Union the DB connections granted by the user's own policies with the
		// roles' ones
		for (const name of userAccess.dbConnections) {
			if (!access.dbConnections.includes(name)) {
				access.dbConnections.push(name);
			}
		}
	}

	return access;
}
