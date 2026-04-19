import { withCache } from "../../utils/with-cache.js";
import { fetchGlobalAccessForRoles } from "./lib/fetch-global-access-for-roles.js";
import { fetchGlobalAccessForUser } from "./lib/fetch-global-access-for-user.js";

//#region src/permissions/modules/fetch-global-access/fetch-global-access.ts
const fetchGlobalAccess = withCache("global-access", _fetchGlobalAccess, ({ user, roles, ip }) => ({
	user,
	roles,
	ip
}));
/**
* Fetch the global access (eg admin/app access) rules for the given roles, or roles+user combination
*
* Will fetch roles and user info separately so they can be cached and reused individually
*/
async function _fetchGlobalAccess(accountability, knex) {
	const access = await fetchGlobalAccessForRoles(accountability, knex);
	if (accountability.user !== void 0) {
		const userAccess = await fetchGlobalAccessForUser(accountability, knex);
		access.app ||= userAccess.app;
		access.admin ||= userAccess.admin;
	}
	return access;
}

//#endregion
export { _fetchGlobalAccess, fetchGlobalAccess };