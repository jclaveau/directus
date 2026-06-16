import { withCache } from "../../utils/with-cache.js";
import { fetchGlobalAccessForRoles, fetchGlobalAccessForUser } from "@directus/utils/node";

//#region src/permissions/modules/fetch-global-access/fetch-global-access.ts
const fetchGlobalAccess = withCache("global-access", _fetchGlobalAccess, ({ user, roles }, { ip }) => ({
	user,
	roles,
	ip
}));
const fetchGlobalAccessForRoles$1 = withCache("global-access-roles", fetchGlobalAccessForRoles, (roles, { ip }) => ({
	roles,
	ip
}));
const fetchGlobalAccessForUser$1 = withCache("global-access-user", fetchGlobalAccessForUser, (user, { ip }) => ({
	user,
	ip
}));
/**
* Re-implements fetchGlobalAccess to add caching, fetches roles and user info separately so they can be cached and reused individually
*/
async function _fetchGlobalAccess(accountability, context) {
	const access = await fetchGlobalAccessForRoles$1(accountability.roles, {
		knex: context.knex,
		ip: accountability.ip
	});
	if (accountability.user !== void 0) {
		const userAccess = await fetchGlobalAccessForUser$1(accountability.user, {
			knex: context.knex,
			ip: accountability.ip
		});
		access.app ||= userAccess.app;
		access.admin ||= userAccess.admin;
	}
	return access;
}

//#endregion
export { _fetchGlobalAccess, fetchGlobalAccess };