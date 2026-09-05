import { withCache } from "../../../utils/with-cache.js";
import { fetchGlobalAccessForQuery } from "../utils/fetch-global-access-for-query.js";

//#region src/permissions/modules/fetch-global-access/lib/fetch-global-access-for-roles.ts
const fetchGlobalAccessForRoles = withCache("global-access-role", _fetchGlobalAccessForRoles, ({ roles, ip }) => ({
	roles,
	ip
}));
async function _fetchGlobalAccessForRoles(accountability, knex) {
	return await fetchGlobalAccessForQuery(knex.where("role", "in", accountability.roles), accountability);
}

//#endregion
export { _fetchGlobalAccessForRoles, fetchGlobalAccessForRoles };